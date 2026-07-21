use image::GenericImageView;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::File,
    io::{self, Read},
    path::Path,
};

pub const ALLOWED_FILES: [&str; 3] = ["pet.json", "spritesheet.webp", "ASSET_LICENSE.txt"];
const REQUIRED_FRAME_COUNTS: [usize; 11] = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
const ATLAS_WIDTH: u32 = 1536;
const ATLAS_HEIGHT: u32 = 2288;
const CELL_WIDTH: u32 = 192;
const CELL_HEIGHT: u32 = 208;

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
    use super::{validate_package, PackageError};
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
}
