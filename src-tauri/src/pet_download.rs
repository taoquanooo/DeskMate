use futures_util::StreamExt;
use reqwest::{header, Client, ClientBuilder, StatusCode};
use std::time::Duration;

pub const MAX_PET_PACKAGE_BYTES: u64 = 25 * 1024 * 1024;

pub fn client_builder(user_agent: &str, idle_timeout: Duration) -> ClientBuilder {
    Client::builder()
        .user_agent(user_agent)
        .connect_timeout(Duration::from_secs(10))
        // A total deadline aborted healthy, slow downloads after 45 seconds.
        // This timer resets whenever more data arrives. Metadata requests set
        // their own short total deadline at the call site.
        .read_timeout(idle_timeout)
        .redirect(reqwest::redirect::Policy::limited(5))
}

/// Append an immutable asset to `bytes`. On a transport error the received
/// prefix survives, including when the caller switches to the GitHub API.
/// The completed package still goes through SHA-256 and ZIP validation.
pub async fn stream_package(
    client: &Client,
    url: url::Url,
    expected_size: u64,
    via_api: bool,
    bytes: &mut Vec<u8>,
    progress: &mut impl FnMut(u64, u64),
) -> Result<(), String> {
    if expected_size == 0 || expected_size > MAX_PET_PACKAGE_BYTES {
        return Err("pet package is too large or empty".into());
    }
    let offset = bytes.len() as u64;
    if offset > expected_size {
        return Err("pet download exceeds the catalog size".into());
    }
    if offset == expected_size {
        return Ok(());
    }
    let mut request = client.get(url).header(header::ACCEPT_ENCODING, "identity");
    if via_api {
        request = request.header(header::ACCEPT, "application/octet-stream");
    }
    if offset > 0 {
        request = request.header(header::RANGE, format!("bytes={offset}-"));
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    let start = match response.status() {
        StatusCode::OK => 0,
        StatusCode::PARTIAL_CONTENT => {
            let range = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok());
            validate_content_range(range, offset, expected_size)?;
            offset
        }
        status => return Err(format!("pet download returned {status}")),
    };
    if response
        .content_length()
        .is_some_and(|length| length != expected_size - start)
    {
        return Err("pet download size does not match the catalog".into());
    }
    // Some servers ignore Range. A full 200 response replaces the prefix;
    // appending it would corrupt the ZIP and always fail the final hash check.
    if start == 0 {
        bytes.clear();
    }
    progress(bytes.len() as u64, expected_size);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            format!(
                "传输中断（已接收 {}/{expected_size} 字节）：{error}",
                bytes.len()
            )
        })?;
        if chunk.len() as u64 > expected_size - bytes.len() as u64 {
            return Err("pet download exceeds the catalog size".into());
        }
        bytes.extend_from_slice(&chunk);
        progress(bytes.len() as u64, expected_size);
    }
    if bytes.len() as u64 != expected_size {
        return Err("pet download size does not match the catalog".into());
    }
    Ok(())
}

fn validate_content_range(range: Option<&str>, offset: u64, total: u64) -> Result<(), String> {
    let parsed = range.and_then(|value| {
        let (span, length) = value.strip_prefix("bytes ")?.split_once('/')?;
        let (start, end) = span.split_once('-')?;
        Some((
            start.parse::<u64>().ok()?,
            end.parse::<u64>().ok()?,
            length.parse::<u64>().ok()?,
        ))
    });
    if total > 0 && offset < total && parsed == Some((offset, total - 1, total)) {
        Ok(())
    } else {
        Err("pet download returned an invalid Content-Range".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Instant,
    };

    // A real local HTTP transport catches response/header handling mistakes
    // that a mocked reqwest Response would hide.
    fn server(
        replies: Vec<(&'static str, &'static [u8], Duration)>,
    ) -> (url::Url, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for (headers, body, delay) in replies {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "HTTP test received no request");
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("{error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    stream.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                    assert!(request.len() < 8192);
                }
                requests.push(String::from_utf8(request).unwrap().to_ascii_lowercase());
                stream.write_all(headers.as_bytes()).unwrap();
                if delay.is_zero() {
                    // A client rejecting headers may close before the body.
                    let _ = stream.write_all(body);
                } else {
                    for byte in body {
                        thread::sleep(delay);
                        if stream.write_all(&[*byte]).is_err() {
                            break;
                        }
                    }
                }
            }
            requests
        });
        (
            url::Url::parse(&format!("http://{address}/pet.zip")).unwrap(),
            handle,
        )
    }

    fn test_client(idle_timeout: Duration) -> Client {
        client_builder("DeskMate/test", idle_timeout)
            .no_proxy()
            .build()
            .unwrap()
    }

    #[test]
    fn slow_download_keeps_running_while_data_arrives() {
        let (url, server) = server(vec![(
            "HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n",
            b"pet-data",
            Duration::from_millis(100),
        )]);
        let client = test_client(Duration::from_millis(500));
        let mut bytes = Vec::new();
        tauri::async_runtime::block_on(stream_package(
            &client,
            url,
            8,
            false,
            &mut bytes,
            &mut |_, _| {},
        ))
        .unwrap();
        assert_eq!(bytes, b"pet-data");
        server.join().unwrap();
    }

    #[test]
    fn interrupted_download_resumes_from_its_prefix_through_the_api() {
        let (url, server) = server(vec![
            ("HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n", b"pet-", Duration::ZERO),
            ("HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 4-7/8\r\nConnection: close\r\n\r\n", b"data", Duration::ZERO),
        ]);
        let client = test_client(Duration::from_secs(2));
        let mut bytes = Vec::new();
        let mut progress = Vec::new();
        tauri::async_runtime::block_on(async {
            let mut report = |downloaded, _| progress.push(downloaded);
            assert!(
                stream_package(&client, url.clone(), 8, false, &mut bytes, &mut report)
                    .await
                    .is_err()
            );
            assert_eq!(bytes, b"pet-");
            stream_package(&client, url, 8, true, &mut bytes, &mut report)
                .await
                .unwrap();
        });
        assert_eq!(bytes, b"pet-data");
        assert!(progress.windows(2).all(|pair| pair[0] <= pair[1]));
        let requests = server.join().unwrap();
        assert!(requests[1].contains("range: bytes=4-"));
        assert!(requests[1].contains("accept: application/octet-stream"));
    }

    #[test]
    fn ignored_range_replaces_the_prefix_instead_of_corrupting_the_package() {
        let (url, server) = server(vec![(
            "HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n",
            b"pet-data",
            Duration::ZERO,
        )]);
        let client = test_client(Duration::from_secs(2));
        let mut bytes = b"pet-".to_vec();
        let mut progress = Vec::new();
        tauri::async_runtime::block_on(stream_package(
            &client,
            url,
            8,
            false,
            &mut bytes,
            &mut |done, _| progress.push(done),
        ))
        .unwrap();
        assert_eq!(bytes, b"pet-data");
        assert_eq!(progress[0], 0);
        server.join().unwrap();
    }

    #[test]
    fn stalled_download_still_times_out() {
        let (url, server) = server(vec![(
            "HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n",
            b"x",
            Duration::from_millis(500),
        )]);
        let client = test_client(Duration::from_millis(100));
        let mut bytes = Vec::new();
        assert!(tauri::async_runtime::block_on(stream_package(
            &client,
            url,
            1,
            false,
            &mut bytes,
            &mut |_, _| {}
        ))
        .is_err());
        assert!(bytes.is_empty());
        server.join().unwrap();
    }

    #[test]
    fn wrong_range_is_rejected_without_changing_the_received_prefix() {
        let (url, server) = server(vec![(
            "HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 0-3/8\r\nConnection: close\r\n\r\n",
            b"pet-", Duration::ZERO,
        )]);
        let client = test_client(Duration::from_secs(2));
        let mut bytes = b"pet-".to_vec();
        assert!(tauri::async_runtime::block_on(stream_package(
            &client,
            url,
            8,
            false,
            &mut bytes,
            &mut |_, _| {}
        ))
        .is_err());
        assert_eq!(bytes, b"pet-");
        server.join().unwrap();
    }

    #[test]
    fn oversized_chunked_body_is_rejected_before_appending() {
        let (url, server) = server(vec![(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            b"8\r\npet-data\r\n0\r\n\r\n",
            Duration::ZERO,
        )]);
        let client = test_client(Duration::from_secs(2));
        let mut bytes = Vec::new();
        assert!(tauri::async_runtime::block_on(stream_package(
            &client,
            url,
            4,
            false,
            &mut bytes,
            &mut |_, _| {}
        ))
        .is_err());
        assert!(bytes.len() <= 4);
        server.join().unwrap();
    }

    #[test]
    fn rejects_mismatched_ranges() {
        for range in [
            None,
            Some("bytes 0-7/8"),
            Some("bytes 4-7/9"),
            Some("bytes 4-6/8"),
            Some("bytes 4-7/*"),
        ] {
            assert!(validate_content_range(range, 4, 8).is_err());
        }
        assert!(validate_content_range(Some("bytes 4-7/8"), 4, 8).is_ok());
    }
}
