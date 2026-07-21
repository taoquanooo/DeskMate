use image::GenericImageView;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
};

pub const ALLOWED_FILES: [&str; 3] = ["pet.json", "spritesheet.webp", "ASSET_LICENSE.txt"];
const REQUIRED_FRAME_COUNTS: [usize; 11] = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
const ATLAS_WIDTH: u32 = 1536;
const ATLAS_HEIGHT: u32 = 2288;
const CELL_WIDTH: u32 = 192;
const CELL_HEIGHT: u32 = 208;
const MAX_LOCAL_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_LOCAL_SPRITESHEET_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PackageError {
    #[error("archive contains an unsafe path")]
    UnsafePath,
    #[error("archive contains unexpected file {0}")]
    UnexpectedFile(String),
    #[error("archive is missing {0}")]
    MissingFile(String),
    #[error("pet.json is invalid")]
    InvalidManifest,
    #[error("spritesheet.webp is not a valid Codex v2 atlas")]
    InvalidSpritesheet,
    #[error("archive exceeds the allowed size")]
    TooLarge,
    #[error("archive cannot be read: {0}")]
    Io(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetManifestV2 {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub sprite_version_number: u8,
    pub spritesheet_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCatalogV1 {
    pub schema_version: u8,
    pub generated_at: String,
    pub pets: Vec<PetCatalogEntryV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetCatalogEntryV1 {
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub description: String,
    pub author: String,
    pub asset_license: String,
    pub sprite_version_number: u8,
    pub min_app_version: String,
    pub preview_url: String,
    pub package_url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPetV1 {
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub description: String,
    pub folder_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPetScanV1 {
    pub folder_path: String,
    pub pets: Vec<LocalPetV1>,
    pub errors: Vec<String>,
}

pub fn scan_local_pets(root: &Path) -> LocalPetScanV1 {
    let mut scan = LocalPetScanV1 {
        folder_path: root.display().to_string(),
        pets: Vec::new(),
        errors: Vec::new(),
    };
    if let Err(error) = std::fs::create_dir_all(root) {
        scan.errors
            .push(format!("无法创建自定义宠物文件夹：{error}"));
        return scan;
    }
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) => {
            scan.errors
                .push(format!("无法读取自定义宠物文件夹：{error}"));
            return scan;
        }
    };
    let mut folders = entries.filter_map(Result::ok).collect::<Vec<_>>();
    folders.sort_by_key(|entry| entry.file_name());
    let mut id_folders = HashMap::<String, String>::new();
    let mut duplicate_ids = HashSet::<String>::new();

    for entry in folders {
        let folder_name = entry.file_name().to_string_lossy().into_owned();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                scan.errors
                    .push(format!("{folder_name}：无法读取（{error}）"));
                continue;
            }
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let manifest = match validate_local_pet_directory(&entry.path()) {
            Ok(manifest) => manifest,
            Err(error) => {
                scan.errors.push(format!("{folder_name}：{error}"));
                continue;
            }
        };
        if manifest.id == "yanghao" {
            scan.errors
                .push(format!("{folder_name}：宠物 id ‘yanghao’ 为内置宠物保留"));
            continue;
        }
        if let Some(first_folder) = id_folders.insert(manifest.id.clone(), folder_name.clone()) {
            duplicate_ids.insert(manifest.id.clone());
            scan.errors.push(format!(
                "{folder_name}：宠物 id ‘{}’ 已被文件夹 {first_folder} 使用",
                manifest.id
            ));
        }
        scan.pets.push(LocalPetV1 {
            id: manifest.id,
            version: "local".into(),
            display_name: manifest.display_name,
            description: manifest.description,
            folder_name,
        });
    }
    scan.pets.retain(|pet| !duplicate_ids.contains(&pet.id));
    scan
}

pub fn find_local_pet(root: &Path, id: &str) -> Result<(PetManifestV2, PathBuf), String> {
    let scan = scan_local_pets(root);
    let pet = scan
        .pets
        .into_iter()
        .find(|pet| pet.id == id)
        .ok_or_else(|| format!("找不到有效的本地宠物 {id}"))?;
    let directory = root.join(&pet.folder_name);
    let manifest = validate_local_pet_directory(&directory)?;
    if manifest.id != id {
        return Err("宠物文件在扫描后发生了变化，请重新扫描".into());
    }
    Ok((manifest, directory.join("spritesheet.webp")))
}

fn validate_local_pet_directory(directory: &Path) -> Result<PetManifestV2, String> {
    let manifest_path = directory.join("pet.json");
    let spritesheet_path = directory.join("spritesheet.webp");
    let manifest_bytes = read_regular_local_file(&manifest_path, MAX_LOCAL_MANIFEST_BYTES)
        .map_err(|error| format!("pet.json {error}"))?;
    let spritesheet_bytes = read_regular_local_file(&spritesheet_path, MAX_LOCAL_SPRITESHEET_BYTES)
        .map_err(|error| format!("spritesheet.webp {error}"))?;
    let manifest = validate_manifest(&manifest_bytes).map_err(|error| error.to_string())?;
    validate_spritesheet(&spritesheet_bytes).map_err(|error| error.to_string())?;
    Ok(manifest)
}

fn read_regular_local_file(path: &Path, maximum_bytes: u64) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| format!("无法读取：{error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("必须是普通文件，不能使用链接".into());
    }
    if metadata.len() > maximum_bytes {
        return Err("文件过大".into());
    }
    std::fs::read(path).map_err(|error| format!("无法读取：{error}"))
}

pub fn validate_catalog(
    catalog: &PetCatalogV1,
    app_version: &semver::Version,
) -> Result<(), String> {
    if catalog.schema_version != 1 {
        return Err("catalog schemaVersion must be 1".into());
    }
    chrono::DateTime::parse_from_rfc3339(&catalog.generated_at)
        .map_err(|_| "generatedAt must be RFC 3339")?;
    let mut entries = HashSet::new();
    for pet in &catalog.pets {
        if pet.sprite_version_number != 2 {
            return Err(format!("{} must use sprite v2", pet.id));
        }
        if !entries.insert(format!("{}@{}", pet.id, pet.version)) {
            return Err("duplicate catalog entry".into());
        }
        semver::Version::parse(&pet.version).map_err(|_| "invalid pet version")?;
        let minimum =
            semver::Version::parse(&pet.min_app_version).map_err(|_| "invalid minAppVersion")?;
        if minimum > *app_version {
            continue;
        }
        for raw in [&pet.preview_url, &pet.package_url] {
            let url = url::Url::parse(raw).map_err(|_| "invalid catalog URL")?;
            if url.scheme() != "https" {
                return Err("catalog URLs must use HTTPS".into());
            }
        }
        if pet.sha256.len() != 64 || hex::decode(&pet.sha256).is_err() {
            return Err("invalid SHA-256".into());
        }
        if pet.size_bytes == 0 || pet.size_bytes > 25 * 1024 * 1024 {
            return Err("invalid package size".into());
        }
    }
    Ok(())
}

pub fn validate_package(path: &Path, maximum_bytes: u64) -> Result<(), PackageError> {
    let file = File::open(path).map_err(io_error)?;
    if file.metadata().map_err(io_error)?.len() > maximum_bytes {
        return Err(PackageError::TooLarge);
    }
    let mut zip =
        zip::ZipArchive::new(file).map_err(|error| PackageError::Io(error.to_string()))?;
    let mut seen = HashSet::new();
    let mut total = 0_u64;
    for index in 0..zip.len() {
        let entry = zip
            .by_index(index)
            .map_err(|error| PackageError::Io(error.to_string()))?;
        let Some(enclosed) = entry.enclosed_name() else {
            return Err(PackageError::UnsafePath);
        };
        if enclosed.components().count() != 1 || entry.is_dir() {
            return Err(PackageError::UnsafePath);
        }
        let name = enclosed.to_string_lossy().into_owned();
        if !ALLOWED_FILES.contains(&name.as_str()) {
            return Err(PackageError::UnexpectedFile(name));
        }
        if !seen.insert(name.clone()) {
            return Err(PackageError::UnexpectedFile(name));
        }
        total = total
            .checked_add(entry.size())
            .ok_or(PackageError::TooLarge)?;
        if total > maximum_bytes {
            return Err(PackageError::TooLarge);
        }
    }
    for required in ALLOWED_FILES {
        if !seen.contains(required) {
            return Err(PackageError::MissingFile(required.into()));
        }
    }
    let manifest = read_entry(&mut zip, "pet.json", 64 * 1024)?;
    validate_manifest(&manifest)?;
    let spritesheet = read_entry(&mut zip, "spritesheet.webp", maximum_bytes as usize)?;
    validate_spritesheet(&spritesheet)?;
    Ok(())
}

pub fn extract_validated_package(path: &Path, destination: &Path) -> Result<(), PackageError> {
    std::fs::create_dir_all(destination).map_err(io_error)?;
    let file = File::open(path).map_err(io_error)?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|error| PackageError::Io(error.to_string()))?;
    for name in ALLOWED_FILES {
        let mut source = zip
            .by_name(name)
            .map_err(|_| PackageError::MissingFile(name.into()))?;
        let mut destination_file = File::create(destination.join(name)).map_err(io_error)?;
        io::copy(&mut source, &mut destination_file).map_err(io_error)?;
        destination_file.sync_all().map_err(io_error)?;
    }
    Ok(())
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn validate_manifest(bytes: &[u8]) -> Result<PetManifestV2, PackageError> {
    let manifest: PetManifestV2 =
        serde_json::from_slice(bytes).map_err(|_| PackageError::InvalidManifest)?;
    let valid_id = !manifest.id.is_empty()
        && manifest.id.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if !valid_id
        || manifest.display_name.trim().is_empty()
        || manifest.description.trim().is_empty()
        || manifest.sprite_version_number != 2
        || manifest.spritesheet_path != "spritesheet.webp"
    {
        return Err(PackageError::InvalidManifest);
    }
    Ok(manifest)
}

fn validate_spritesheet(bytes: &[u8]) -> Result<(), PackageError> {
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::WebP)
        .map_err(|_| PackageError::InvalidSpritesheet)?;
    if image.dimensions() != (ATLAS_WIDTH, ATLAS_HEIGHT) || !image.color().has_alpha() {
        return Err(PackageError::InvalidSpritesheet);
    }
    let rgba = image.to_rgba8();
    for (row, used_columns) in REQUIRED_FRAME_COUNTS.into_iter().enumerate() {
        for column in 0..used_columns {
            if !cell_has_alpha(&rgba, row as u32, column as u32) {
                return Err(PackageError::InvalidSpritesheet);
            }
        }
        for column in used_columns..8 {
            if cell_has_alpha(&rgba, row as u32, column as u32) {
                return Err(PackageError::InvalidSpritesheet);
            }
        }
    }
    Ok(())
}

fn cell_has_alpha(image: &image::RgbaImage, row: u32, column: u32) -> bool {
    let x0 = column * CELL_WIDTH;
    let y0 = row * CELL_HEIGHT;
    (y0..y0 + CELL_HEIGHT).any(|y| (x0..x0 + CELL_WIDTH).any(|x| image.get_pixel(x, y)[3] != 0))
}

fn read_entry(
    zip: &mut zip::ZipArchive<File>,
    name: &str,
    limit: usize,
) -> Result<Vec<u8>, PackageError> {
    let mut entry = zip
        .by_name(name)
        .map_err(|_| PackageError::MissingFile(name.into()))?;
    if entry.size() > limit as u64 {
        return Err(PackageError::TooLarge);
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes).map_err(io_error)?;
    Ok(bytes)
}

fn io_error(error: impl std::fmt::Display) -> PackageError {
    PackageError::Io(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        scan_local_pets, validate_package, PackageError, ATLAS_HEIGHT, ATLAS_WIDTH, CELL_HEIGHT,
        CELL_WIDTH, REQUIRED_FRAME_COUNTS,
    };
    use std::io::Write;

    fn write_zip(path: &std::path::Path, names: &[&str]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        for name in names {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"test").unwrap();
        }
        zip.finish().unwrap();
    }

    fn write_valid_v2_spritesheet(path: &std::path::Path) {
        let mut atlas = image::RgbaImage::new(ATLAS_WIDTH, ATLAS_HEIGHT);
        for (row, frame_count) in REQUIRED_FRAME_COUNTS.into_iter().enumerate() {
            for column in 0..frame_count {
                atlas.put_pixel(
                    column as u32 * CELL_WIDTH + CELL_WIDTH / 2,
                    row as u32 * CELL_HEIGHT + CELL_HEIGHT / 2,
                    image::Rgba([255, 255, 255, 255]),
                );
            }
        }

        let file = std::fs::File::create(path).unwrap();
        image::codecs::webp::WebPEncoder::new_lossless(file)
            .encode(
                atlas.as_raw(),
                ATLAS_WIDTH,
                ATLAS_HEIGHT,
                image::ExtendedColorType::Rgba8,
            )
            .unwrap();
    }

    #[test]
    fn rejects_path_traversal_before_extraction() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pet.zip");
        write_zip(
            &path,
            &["../pet.json", "spritesheet.webp", "ASSET_LICENSE.txt"],
        );
        assert_eq!(
            validate_package(&path, 1_000_000),
            Err(PackageError::UnsafePath)
        );
    }

    #[test]
    fn rejects_files_outside_the_allowlist() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pet.zip");
        write_zip(
            &path,
            &[
                "pet.json",
                "spritesheet.webp",
                "ASSET_LICENSE.txt",
                "script.exe",
            ],
        );
        assert_eq!(
            validate_package(&path, 1_000_000),
            Err(PackageError::UnexpectedFile("script.exe".into()))
        );
    }

    #[test]
    fn scans_valid_local_pets_and_reports_invalid_folders() {
        let directory = tempfile::tempdir().unwrap();
        let valid = directory.path().join("studio-cat");
        std::fs::create_dir_all(&valid).unwrap();
        std::fs::write(
            valid.join("pet.json"),
            r#"{
                "id":"studio-cat",
                "displayName":"工作室小猫",
                "description":"本机宠物",
                "spriteVersionNumber":2,
                "spritesheetPath":"spritesheet.webp"
            }"#
            .as_bytes(),
        )
        .unwrap();
        write_valid_v2_spritesheet(&valid.join("spritesheet.webp"));
        let invalid = directory.path().join("broken-pet");
        std::fs::create_dir_all(&invalid).unwrap();
        std::fs::write(invalid.join("pet.json"), b"not json").unwrap();
        std::fs::write(invalid.join("spritesheet.webp"), b"not webp").unwrap();

        let scan = scan_local_pets(directory.path());

        assert_eq!(scan.pets.len(), 1);
        assert_eq!(scan.pets[0].id, "studio-cat");
        assert_eq!(scan.pets[0].version, "local");
        assert!(scan.errors.iter().any(|error| error.contains("broken-pet")));
    }
}
