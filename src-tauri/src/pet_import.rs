use crate::{pet_download::MAX_PET_PACKAGE_BYTES, pet_trash, pets};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub const STAGING_FOLDER: &str = ".deskmate-imports";

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportSource {
    Url { url: String },
    File { path: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub task_id: String,
    pub stage: &'static str,
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub token: String,
    pub id: String,
    pub display_name: String,
    pub conflict: Option<String>,
}

pub struct PreparedImport {
    pub root: PathBuf,
    pub staging: PathBuf,
    pub pet: pets::ValidatedLocalPet,
}

impl Drop for PreparedImport {
    fn drop(&mut self) {
        // Only delete files this importer created. Never follow directory links.
        if fs::symlink_metadata(&self.staging)
            .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
        {
            let pet_dir = self.staging.join("pet");
            if fs::symlink_metadata(&pet_dir)
                .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
            {
                for name in pets::ALLOWED_FILES {
                    let _ = fs::remove_file(pet_dir.join(name));
                }
                let _ = fs::remove_dir(&pet_dir);
            }
            let _ = fs::remove_file(self.staging.join("package.zip"));
            let _ = fs::remove_dir(&self.staging);
        }
    }
}

fn real_directory(path: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("安装目录不能是链接".into());
    }
    path.canonicalize().map_err(|e| e.to_string())
}

pub fn new_staging(root: &Path) -> Result<(String, PathBuf, PathBuf), String> {
    let root = real_directory(root)?;
    let parent = real_directory(&root.join(STAGING_FOLDER))?;
    if parent.parent() != Some(root.as_path()) {
        return Err("暂存目录超出自定义宠物文件夹".into());
    }
    let token = format!(
        "{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    );
    let staging = parent.join(&token);
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    Ok((token, root, staging))
}

pub async fn download(
    url: &str,
    progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<Vec<u8>, String> {
    let url = url::Url::parse(url.trim()).map_err(|_| "压缩包链接无效")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("请输入无需登录的 HTTPS 压缩包直链".into());
    }
    let client = crate::pet_download::client_builder(
        "DeskMate pet import",
        std::time::Duration::from_secs(45),
    )
    .redirect(reqwest::redirect::Policy::custom(|attempt| {
        if attempt.url().scheme() != "https" || attempt.previous().len() >= 5 {
            attempt.error("不允许此下载重定向")
        } else {
            attempt.follow()
        }
    }))
    .build()
    .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败：{e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = response.content_length();
    if total.is_some_and(|n| n > MAX_PET_PACKAGE_BYTES) {
        return Err("ZIP 超过 25 MiB".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断，请重试：{e}"))?;
        if bytes.len() as u64 + chunk.len() as u64 > MAX_PET_PACKAGE_BYTES {
            return Err("ZIP 超过 25 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
        progress(bytes.len() as u64, total);
    }
    Ok(bytes)
}

/// Normalize a root-layout or single-folder ZIP without relaxing official packages.
pub fn extract_custom_zip(
    package: &Path,
    destination: &Path,
) -> Result<pets::ValidatedLocalPet, String> {
    let file = fs::File::open(package).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_PET_PACKAGE_BYTES {
        return Err("ZIP 超过 25 MiB".into());
    }
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "无法读取 ZIP，文件可能已损坏")?;
    if zip.len() > 16 {
        return Err("ZIP 文件数量过多，请只打包一只宠物".into());
    }
    let mut files = Vec::new();
    let mut prefix: Option<PathBuf> = None;
    let mut total = 0u64;
    let mut seen = std::collections::HashSet::new();
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|e| e.to_string())?;
        if entry.name().contains(['\\', ':'])
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("ZIP 包含不安全的路径或链接".into());
        }
        let path = entry.enclosed_name().ok_or("ZIP 路径越界")?.to_path_buf();
        if path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err("ZIP 路径无效".into());
        }
        if entry.is_dir() {
            if path.components().count() != 1 {
                return Err("ZIP 目录层级过多".into());
            }
            continue;
        }
        if !(1..=2).contains(&path.components().count()) {
            return Err("ZIP 应只包含一个宠物文件夹".into());
        }
        let parent = path.parent().unwrap_or(Path::new("")).to_path_buf();
        if let Some(expected) = &prefix {
            if expected != &parent {
                return Err("ZIP 包含多只宠物或混合目录".into());
            }
        } else {
            prefix = Some(parent);
        }
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if !pets::ALLOWED_FILES.contains(&name.as_str()) || !seen.insert(name.clone()) {
            return Err(format!("ZIP 包含多余或重复文件：{name}"));
        }
        total = total.checked_add(entry.size()).ok_or("ZIP 解压大小超限")?;
        if total > MAX_PET_PACKAGE_BYTES {
            return Err("ZIP 解压后超过 25 MiB".into());
        }
        files.push((index, name, entry.size()));
    }
    if !seen.contains("pet.json") || !seen.contains("spritesheet.webp") {
        return Err("ZIP 缺少 pet.json 或 spritesheet.webp".into());
    }
    fs::create_dir(destination).map_err(|e| e.to_string())?;
    for (index, name, expected) in files {
        let entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        entry
            .take(expected + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 != expected {
            return Err("ZIP 文件大小与声明不一致".into());
        }
        let mut out = fs::File::create(destination.join(name)).map_err(|e| e.to_string())?;
        out.write_all(&bytes)
            .and_then(|_| out.sync_all())
            .map_err(|e| e.to_string())?;
    }
    let pet = pets::validate_local_pet_directory(destination)?;
    if pet.id == "yanghao" {
        return Err("宠物 ID yanghao 为内置宠物保留，请修改清单后重新打包".into());
    }
    Ok(pet)
}

pub fn conflict(root: &Path, id: &str) -> Result<Option<pets::LocalPetV1>, String> {
    let scan = pets::scan_local_pets(root);
    let matching_folders = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_name() != STAGING_FOLDER && entry.file_name() != pet_trash::TRASH_FOLDER
        })
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|ty| ty.is_dir() && !ty.is_symlink())
        })
        .filter(|entry| {
            let manifest = entry.path().join("pet.json");
            if !fs::symlink_metadata(&manifest)
                .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink() && m.len() <= 64 * 1024)
            {
                return false;
            }
            fs::read(&manifest)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .is_some_and(|json| json.get("id").and_then(|value| value.as_str()) == Some(id))
        })
        .count();
    let valid = scan.pets.into_iter().find(|pet| pet.id == id);
    if matching_folders > usize::from(valid.is_some()) {
        return Err("已有同 ID 的无效宠物，请先修复或移走该文件夹".into());
    }
    Ok(valid)
}

pub fn commit(prepared: &PreparedImport, replace: bool) -> Result<(), String> {
    commit_with(prepared, replace, |source, dest| fs::rename(source, dest))
}

fn commit_with(
    prepared: &PreparedImport,
    replace: bool,
    rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    if real_directory(&prepared.root)? != prepared.root
        || real_directory(&prepared.staging)?.parent()
            != Some(prepared.root.join(STAGING_FOLDER).as_path())
        || real_directory(&prepared.staging.join("pet"))?.parent()
            != Some(prepared.staging.as_path())
    {
        return Err("安装目录已变化，请重新导入".into());
    }
    let verified = pets::validate_local_pet_directory(&prepared.staging.join("pet"))?;
    if verified.id != prepared.pet.id {
        return Err("宠物清单已变化，请重新导入".into());
    }
    let current = conflict(&prepared.root, &prepared.pet.id)?;
    if current.is_some() && !replace {
        return Err("宠物已存在，需要先确认替换".into());
    }
    let name = current
        .as_ref()
        .map_or(prepared.pet.id.as_str(), |pet| pet.folder_name.as_str());
    let destination = prepared.root.join(name);
    if current.is_none() && destination.exists() {
        return Err("安装位置已被其他文件占用，请先重命名".into());
    }
    let recycled = current
        .as_ref()
        .map(|pet| pet_trash::recycle(&prepared.root, &pet.folder_name, &pet.display_name))
        .transpose()
        .map_err(|e| e.to_string())?;
    if let Err(error) = rename(&prepared.staging.join("pet"), &destination) {
        if let Some(old) = recycled {
            pet_trash::restore(&prepared.root, &old.id).map_err(|rollback| {
                format!("安装失败：{error}；旧宠物仍在回收站，恢复失败：{rollback}")
            })?;
        }
        return Err(format!("安装失败，旧宠物已恢复：{error}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn zip(path: &Path, folder: &str) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for name in ["pet.json", "spritesheet.webp"] {
            zip.start_file(
                format!("{folder}{name}"),
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            let mut bytes = fs::read(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../public/pets/yanghao")
                    .join(name),
            )
            .unwrap();
            if name == "pet.json" {
                let mut manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                manifest["id"] = "custom-fixture".into();
                bytes = serde_json::to_vec(&manifest).unwrap();
            }
            zip.write_all(&bytes).unwrap();
        }
        zip.finish().unwrap();
    }
    #[test]
    fn imports_both_layouts_and_staging_is_not_scanned() {
        for prefix in ["", "my-pet/"] {
            let dir = tempfile::tempdir().unwrap();
            let (token, root, staging) = new_staging(dir.path()).unwrap();
            zip(&staging.join("package.zip"), prefix);
            let pet =
                extract_custom_zip(&staging.join("package.zip"), &staging.join("pet")).unwrap();
            let prepared = PreparedImport { root, staging, pet };
            assert!(pets::scan_local_pets(dir.path()).errors.is_empty());
            commit(&prepared, false).unwrap();
            assert_eq!(pets::scan_local_pets(dir.path()).pets.len(), 1);
            drop(prepared);
            assert!(!dir.path().join(STAGING_FOLDER).join(token).exists());
        }
    }
    #[test]
    fn replacement_requires_confirmation_and_rolls_back_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let (_, root, staging) = new_staging(dir.path()).unwrap();
        zip(&staging.join("package.zip"), "");
        let pet = extract_custom_zip(&staging.join("package.zip"), &staging.join("pet")).unwrap();
        let prepared = PreparedImport { root, staging, pet };
        fs::create_dir(dir.path().join(&prepared.pet.id)).unwrap();
        for name in ["pet.json", "spritesheet.webp"] {
            fs::copy(
                prepared.staging.join("pet").join(name),
                dir.path().join(&prepared.pet.id).join(name),
            )
            .unwrap();
        }
        fs::write(
            dir.path().join(&prepared.pet.id).join("source.txt"),
            "original",
        )
        .unwrap();
        assert!(commit(&prepared, false).is_err());
        assert!(
            commit_with(&prepared, true, |_, _| Err(std::io::Error::other(
                "disk failure"
            )))
            .is_err()
        );
        assert!(dir
            .path()
            .join(&prepared.pet.id)
            .join("source.txt")
            .exists());
        commit(&prepared, true).unwrap();
        assert_eq!(pet_trash::list(dir.path()).unwrap().len(), 1);
    }
    #[test]
    fn rejects_traversal_links_extra_files_and_oversize() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["../pet.json", "pet.exe", "a/b/pet.json", "C:/pet.json"] {
            let package = dir.path().join("bad.zip");
            let mut z = zip::ZipWriter::new(fs::File::create(&package).unwrap());
            z.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
            assert!(extract_custom_zip(&package, &dir.path().join("out")).is_err());
        }
        let package = dir.path().join("bad.zip");
        fs::write(&package, b"corrupt zip").unwrap();
        assert!(extract_custom_zip(&package, &dir.path().join("out")).is_err());
        let mut z = zip::ZipWriter::new(fs::File::create(&package).unwrap());
        z.add_symlink(
            "pet.json",
            "../elsewhere",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        z.finish().unwrap();
        assert!(extract_custom_zip(&package, &dir.path().join("out"))
            .unwrap_err()
            .contains("链接"));
        let mut z = zip::ZipWriter::new(fs::File::create(&package).unwrap());
        z.start_file(
            "pet.json",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        z.write_all(&vec![0; MAX_PET_PACKAGE_BYTES as usize + 1])
            .unwrap();
        z.finish().unwrap();
        assert!(extract_custom_zip(&package, &dir.path().join("out"))
            .unwrap_err()
            .contains("解压后"));
        fs::File::create(&package)
            .unwrap()
            .set_len(MAX_PET_PACKAGE_BYTES + 1)
            .unwrap();
        assert!(extract_custom_zip(&package, &dir.path().join("out"))
            .unwrap_err()
            .contains("超过"));
    }
    #[test]
    fn cancelling_prepared_import_does_not_change_existing_pet() {
        let dir = tempfile::tempdir().unwrap();
        let (_, root, staging) = new_staging(dir.path()).unwrap();
        zip(&staging.join("package.zip"), "");
        let pet = extract_custom_zip(&staging.join("package.zip"), &staging.join("pet")).unwrap();
        let prepared = PreparedImport {
            root,
            staging: staging.clone(),
            pet,
        };
        commit(&prepared, false).unwrap();
        let existing = fs::read(dir.path().join("custom-fixture/pet.json")).unwrap();
        drop(prepared);
        let (_, root, staging) = new_staging(dir.path()).unwrap();
        zip(&staging.join("package.zip"), "");
        let pet = extract_custom_zip(&staging.join("package.zip"), &staging.join("pet")).unwrap();
        drop(PreparedImport {
            root,
            staging: staging.clone(),
            pet,
        });
        assert!(!staging.exists());
        assert_eq!(
            fs::read(dir.path().join("custom-fixture/pet.json")).unwrap(),
            existing
        );
        assert!(pet_trash::list(dir.path()).unwrap().is_empty());
    }
}
