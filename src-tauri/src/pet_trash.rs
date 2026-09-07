use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Component, Path, PathBuf},
};

// Keep the trash beside the user's pets so recycling is an atomic rename,
// including custom folders on a different disk from app data.
pub const TRASH_FOLDER: &str = ".deskmate-trash";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub display_name: String,
    pub folder_name: String,
    pub deleted_at: i64,
}

fn error(message: &str) -> io::Error {
    io::Error::other(message)
}

fn child(parent: &Path, name: &str) -> io::Result<PathBuf> {
    let mut parts = Path::new(name).components();
    if !matches!(parts.next(), Some(Component::Normal(_)))
        || parts.next().is_some()
        || name.contains(['/', '\\', ':'])
    {
        return Err(error("回收站路径无效"));
    }
    Ok(parent.join(name))
}

fn checked_directory(parent: &Path, name: &str) -> io::Result<PathBuf> {
    let path = child(parent, name)?;
    if fs::symlink_metadata(&path)?.file_type().is_symlink() {
        return Err(error("不能移动链接目录"));
    }
    let canonical = path.canonicalize()?;
    if canonical.parent() != Some(parent) || !canonical.is_dir() {
        return Err(error("目录超出自定义宠物文件夹"));
    }
    Ok(canonical)
}

fn trash_root(root: &Path, create: bool) -> io::Result<Option<PathBuf>> {
    let path = root.join(TRASH_FOLDER);
    if !path.try_exists()? {
        if !create {
            return Ok(None);
        }
        fs::create_dir(&path)?;
    }
    checked_directory(root, TRASH_FOLDER).map(Some)
}

pub fn recycle(root: &Path, folder_name: &str, display_name: &str) -> io::Result<TrashEntry> {
    if folder_name == TRASH_FOLDER {
        return Err(error("不能回收宠物回收站本身"));
    }
    let root = root.canonicalize()?;
    let source = checked_directory(&root, folder_name)?;
    let trash = trash_root(&root, true)?.ok_or_else(|| error("无法创建宠物回收站"))?;
    let entry = TrashEntry {
        id: format!(
            "{}-{:016x}",
            chrono::Utc::now().timestamp_millis(),
            rand::random::<u64>()
        ),
        display_name: display_name.to_owned(),
        folder_name: folder_name.to_owned(),
        deleted_at: chrono::Utc::now().timestamp_millis(),
    };
    let entry_path = child(&trash, &entry.id)?;
    fs::create_dir(&entry_path)?;
    // Write metadata before moving any user data. A failed write leaves the
    // original pet intact; a crash after rename leaves a recoverable entry.
    let mut metadata = fs::File::create(entry_path.join("entry.json"))?;
    use io::Write;
    metadata.write_all(&serde_json::to_vec(&entry).map_err(io::Error::other)?)?;
    metadata.sync_all()?;
    fs::rename(source, entry_path.join("pet"))?;
    Ok(entry)
}

pub fn list(root: &Path) -> io::Result<Vec<TrashEntry>> {
    if !root.try_exists()? {
        return Ok(Vec::new());
    }
    let root = root.canonicalize()?;
    let Some(trash) = trash_root(&root, false)? else {
        return Ok(Vec::new());
    };
    let mut result = Vec::new();
    for item in fs::read_dir(&trash)? {
        let item = item?;
        let id = item.file_name().to_string_lossy().into_owned();
        let Ok(path) = checked_directory(&trash, &id) else {
            continue;
        };
        // Incomplete metadata-only entries contain no deleted pet.
        if checked_directory(&path, "pet").is_err() {
            continue;
        }
        let entry: TrashEntry = serde_json::from_slice(&fs::read(path.join("entry.json"))?)
            .map_err(io::Error::other)?;
        if entry.id != id || entry.folder_name == TRASH_FOLDER {
            return Err(error("回收站记录无效"));
        }
        child(&root, &entry.folder_name)?;
        result.push(entry);
    }
    result.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(result)
}

pub fn restore(root: &Path, id: &str) -> io::Result<()> {
    let root = root.canonicalize()?;
    let trash = trash_root(&root, false)?.ok_or_else(|| error("宠物回收站不存在"))?;
    let entry_path = checked_directory(&trash, id)?;
    let entry: TrashEntry = serde_json::from_slice(&fs::read(entry_path.join("entry.json"))?)
        .map_err(io::Error::other)?;
    if entry.id != id || entry.folder_name == TRASH_FOLDER {
        return Err(error("回收站记录无效"));
    }
    let destination = child(&root, &entry.folder_name)?;
    if fs::symlink_metadata(&destination).is_ok() {
        return Err(error(
            "原位置已有同名文件夹，请先在自定义宠物文件夹中重命名它，再恢复；现有内容不会被覆盖",
        ));
    }
    let source = checked_directory(&entry_path, "pet")?;
    fs::rename(source, destination)?;
    // Never recursively delete a trash entry: only remove our own metadata.
    let _ = fs::remove_file(entry_path.join("entry.json"));
    let _ = fs::remove_dir(entry_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip_preserves_all_files_across_reopening_the_trash() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("my-pet/source")).unwrap();
        fs::write(
            root.path().join("my-pet/source/original.txt"),
            b"irreplaceable source",
        )
        .unwrap();
        let entry = recycle(root.path(), "my-pet", "我的宠物").unwrap();
        assert!(!root.path().join("my-pet").exists());
        assert_eq!(list(root.path()).unwrap()[0].id, entry.id);
        assert!(crate::pets::scan_local_pets(root.path()).errors.is_empty());
        restore(root.path(), &entry.id).unwrap();
        assert_eq!(
            fs::read(root.path().join("my-pet/source/original.txt")).unwrap(),
            b"irreplaceable source"
        );
        assert!(list(root.path()).unwrap().is_empty());
    }
    #[test]
    fn restore_collision_keeps_both_copies_intact() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("pet")).unwrap();
        fs::write(root.path().join("pet/original"), b"old").unwrap();
        let entry = recycle(root.path(), "pet", "pet").unwrap();
        fs::create_dir(root.path().join("pet")).unwrap();
        fs::write(root.path().join("pet/new"), b"new").unwrap();
        assert!(restore(root.path(), &entry.id).is_err());
        assert_eq!(fs::read(root.path().join("pet/new")).unwrap(), b"new");
        assert_eq!(list(root.path()).unwrap().len(), 1);
    }
    #[test]
    fn rejects_traversal_and_reserved_folders() {
        let root = tempfile::tempdir().unwrap();
        for name in [
            "..",
            "../outside",
            "..\\outside",
            "C:\\outside",
            TRASH_FOLDER,
        ] {
            assert!(recycle(root.path(), name, "invalid").is_err());
        }
        assert!(list(root.path()).unwrap().is_empty());
    }
}
