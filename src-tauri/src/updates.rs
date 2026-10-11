use crate::{AppState, ReadyUpdate, UpdateStatus};
use serde::Serialize;
use std::{
    future::Future,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Github,
    Mirror,
}

impl Source {
    fn label(self) -> &'static str {
        match self {
            Self::Github => "GitHub",
            Self::Mirror => "备用渠道",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: &'static str,
    pub source: Source,
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[derive(Default)]
pub struct CheckGate {
    lock: tokio::sync::Mutex<()>,
    last: Mutex<Option<(Instant, Result<UpdateStatus, String>)>>,
}

impl CheckGate {
    pub async fn run<F: Future<Output = Result<UpdateStatus, String>>>(
        &self,
        check: impl FnOnce() -> F,
    ) -> Result<UpdateStatus, String> {
        let requested = Instant::now();
        let _guard = self.lock.lock().await;
        let shared = self
            .last
            .lock()
            .map_err(|_| "更新状态不可用")?
            .as_ref()
            .filter(|(finished, _)| *finished >= requested)
            .map(|(_, result)| result.clone());
        if let Some(result) = shared {
            return result;
        }
        let result = check().await;
        *self.last.lock().map_err(|_| "更新状态不可用")? = Some((Instant::now(), result.clone()));
        result
    }
}

#[derive(Clone)]
pub struct Candidate<T> {
    pub version: String,
    pub notes: Option<String>,
    pub payload: T,
}
pub struct Outcome<T> {
    pub source: Source,
    pub candidate: Option<Candidate<T>>,
    pub bytes: Vec<u8>,
}

/// Fall back after metadata OR download failure, without losing a known newer version.
pub async fn channels<T: Clone, C, D, CF, DF>(
    sources: &[Source],
    mut check: C,
    mut download: D,
) -> Result<Outcome<T>, String>
where
    C: FnMut(Source) -> CF,
    CF: Future<Output = Result<Option<Candidate<T>>, String>>,
    D: FnMut(Source, Candidate<T>) -> DF,
    DF: Future<Output = Result<Vec<u8>, String>>,
{
    let mut minimum: Option<semver::Version> = None;
    let mut errors = Vec::new();
    for &source in sources {
        match check(source).await {
            Ok(None) if minimum.is_none() => {
                return Ok(Outcome {
                    source,
                    candidate: None,
                    bytes: Vec::new(),
                })
            }
            Ok(None) => errors.push(format!("{}尚未提供已发现的新版本", source.label())),
            Ok(Some(candidate)) => {
                let Ok(version) = semver::Version::parse(&candidate.version) else {
                    errors.push(format!("{}返回的版本号无效", source.label()));
                    continue;
                };
                if minimum.as_ref().is_some_and(|known| &version < known) {
                    errors.push(format!(
                        "{}版本较旧，未用于替换已发现的更新",
                        source.label()
                    ));
                    continue;
                }
                minimum = Some(version);
                match download(source, candidate.clone()).await {
                    Ok(bytes) => {
                        return Ok(Outcome {
                            source,
                            candidate: Some(candidate),
                            bytes,
                        })
                    }
                    Err(error) => {
                        errors.push(format!("{}下载或签名验证失败：{error}", source.label()))
                    }
                }
            }
            Err(error) => errors.push(format!("{}检查失败：{error}", source.label())),
        }
    }
    Err(errors.join("；"))
}

pub fn mirror_endpoint(base: &str) -> Option<url::Url> {
    let normalized = format!("{}/", base.trim().trim_end_matches('/'));
    let url = url::Url::parse(&normalized).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    url.join("latest.json").ok()
}

pub async fn check(app: &tauri::AppHandle) -> Result<UpdateStatus, String> {
    app.state::<AppState>()
        .update_gate
        .run(|| perform(app))
        .await
}

async fn perform(app: &tauri::AppHandle) -> Result<UpdateStatus, String> {
    let primary = crate::updater_endpoint().ok_or("此构建未配置应用更新")?;
    let mirror = option_env!("DESKMATE_UPDATE_MIRROR_BASE_URL").and_then(mirror_endpoint);
    // Preview builds can check signatures with the same bundled public key.
    let public_key = option_env!("DESKMATE_UPDATER_PUBLIC_KEY")
        .filter(|key| !key.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            app.config()
                .plugins
                .0
                .get("updater")
                .and_then(|value| value.get("pubkey"))
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
        .ok_or("更新公钥未配置")?;
    let mut sources = vec![Source::Github];
    if mirror.is_some() {
        sources.push(Source::Mirror);
    }
    let report = |stage, source, downloaded, total| {
        let _ = app.emit(
            "update://progress",
            Progress {
                stage,
                source,
                downloaded,
                total,
            },
        );
    };
    let outcome = channels(
        &sources,
        |source| {
            let endpoint = if source == Source::Github {
                primary.clone()
            } else {
                mirror.clone().unwrap()
            };
            let key = public_key.clone();
            async move {
                if source == Source::Mirror {
                    report("switching", source, 0, None);
                }
                report("checking", source, 0, None);
                let updater = app
                    .updater_builder()
                    .pubkey(key)
                    .endpoints(vec![endpoint])
                    .map_err(|e| e.to_string())?
                    .timeout(Duration::from_secs(10))
                    .configure_client(|client| {
                        client
                            .connect_timeout(Duration::from_secs(10))
                            .read_timeout(Duration::from_secs(45))
                    })
                    .build()
                    .map_err(|e| e.to_string())?;
                updater
                    .check()
                    .await
                    .map_err(|e| e.to_string())
                    .map(|update| {
                        update.map(|payload| Candidate {
                            version: payload.version.clone(),
                            notes: payload.body.clone(),
                            payload,
                        })
                    })
            }
        },
        |source, candidate| async move {
            let cached = app
                .state::<AppState>()
                .ready_update
                .lock()
                .ok()
                .and_then(|ready| {
                    ready
                        .as_ref()
                        .filter(|ready| {
                            ready.update.version == candidate.version
                                && ready.update.signature == candidate.payload.signature
                        })
                        .map(|ready| ready.bytes.clone())
                });
            if let Some(bytes) = cached {
                return Ok(bytes);
            }
            if candidate.payload.download_url.scheme() != "https" {
                return Err("安装包必须使用 HTTPS".into());
            }
            report("downloading", source, 0, None);
            let mut received = 0u64;
            candidate
                .payload
                .download(
                    |chunk, total| {
                        received += chunk as u64;
                        report("downloading", source, received, total);
                    },
                    || {
                        report("verifying", source, 0, None);
                    },
                )
                .await
                .map_err(|e| e.to_string())
        },
    )
    .await?;
    let mut status = UpdateStatus {
        available: false,
        downloaded: false,
        version: None,
        notes: None,
        source: Some(outcome.source),
    };
    if let Some(candidate) = outcome.candidate {
        status.available = true;
        status.downloaded = true;
        status.version = Some(candidate.version);
        status.notes = candidate.notes;
        *app.state::<AppState>()
            .ready_update
            .lock()
            .map_err(|_| "更新状态不可用")? = Some(ReadyUpdate {
            update: candidate.payload,
            bytes: outcome.bytes,
        });
        let _ = app.emit("update://ready", &status);
    }
    let _ = app.emit("update://checked", &status);
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    fn candidate(version: &str) -> Candidate<()> {
        Candidate {
            version: version.into(),
            notes: None,
            payload: (),
        }
    }
    #[test]
    fn metadata_and_download_failures_switch_channels() {
        runtime().block_on(async {
            let outcome = channels(
                &[Source::Github, Source::Mirror],
                |source| async move {
                    if source == Source::Github {
                        Err("blocked or invalid JSON".into())
                    } else {
                        Ok(Some(candidate("0.3.0")))
                    }
                },
                |_, _| async { Ok(vec![1]) },
            )
            .await
            .unwrap();
            assert_eq!(outcome.source, Source::Mirror);
            let outcome = channels(
                &[Source::Github, Source::Mirror],
                |_| async { Ok(Some(candidate("0.3.0"))) },
                |source, _| async move {
                    if source == Source::Github {
                        Err("download blocked".into())
                    } else {
                        Ok(vec![2])
                    }
                },
            )
            .await
            .unwrap();
            assert_eq!(outcome.source, Source::Mirror);
        });
    }
    #[test]
    fn stale_mirrors_and_bad_signatures_never_stage_an_update() {
        runtime().block_on(async {
            let failed = channels(
                &[Source::Github, Source::Mirror],
                |source| async move {
                    Ok(Some(candidate(if source == Source::Github {
                        "0.4.0"
                    } else {
                        "0.3.0"
                    })))
                },
                |_, _| async { Err::<Vec<u8>, String>("invalid signature".into()) },
            )
            .await;
            assert!(failed.err().unwrap().contains("版本较旧"));
            let failed = channels(
                &[Source::Github, Source::Mirror],
                |_| async { Ok(Some(candidate("0.4.0"))) },
                |_, _| async { Err::<Vec<u8>, String>("invalid signature".into()) },
            )
            .await
            .err()
            .unwrap();
            assert!(
                failed.contains("GitHub下载或签名验证失败")
                    && failed.contains("备用渠道下载或签名验证失败")
            );
            assert!(channels::<(), _, _, _, _>(
                &[Source::Github, Source::Mirror],
                |_| async { Err("network blocked".into()) },
                |_, _| async { Ok(vec![]) }
            )
            .await
            .is_err());
            let current = channels::<(), _, _, _, _>(
                &[Source::Github, Source::Mirror],
                |_| async { Ok(None) },
                |_, _| async { panic!("must not download") },
            )
            .await
            .unwrap();
            assert!(current.candidate.is_none());
        });
    }
    #[test]
    fn simultaneous_checks_share_one_result() {
        runtime().block_on(async {
            let gate = CheckGate::default();
            let calls = std::sync::atomic::AtomicUsize::new(0);
            let check = || async {
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(10)).await;
                Ok(UpdateStatus {
                    available: false,
                    downloaded: false,
                    version: None,
                    notes: None,
                    source: Some(Source::Github),
                })
            };
            let (a, b) = futures_util::future::join(gate.run(check), gate.run(check)).await;
            assert!(a.is_ok() && b.is_ok());
            assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        });
    }
    #[test]
    fn mirror_base_handles_prefixes_and_rejects_invalid_urls() {
        assert_eq!(
            mirror_endpoint("https://example.com/deskmate")
                .unwrap()
                .as_str(),
            "https://example.com/deskmate/latest.json"
        );
        for invalid in [
            "",
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com?x=1",
        ] {
            assert!(mirror_endpoint(invalid).is_none());
        }
    }
}
