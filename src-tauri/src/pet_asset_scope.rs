use std::{fmt::Display, path::Path};

pub fn authorize_selected_asset<E, F>(spritesheet: &Path, allow_file: F) -> Result<(), String>
where
    E: Display,
    F: FnOnce(&Path) -> Result<(), E>,
{
    allow_file(spritesheet).map_err(|error| format!("无法授权宠物图集：{error}"))
}

#[cfg(test)]
mod tests {
    use super::authorize_selected_asset;
    use std::path::{Path, PathBuf};

    #[test]
    fn authorizes_only_the_selected_spritesheet_path() {
        let spritesheet = PathBuf::from(r"D:\custom-pets\studio-cat\spritesheet.webp");
        let mut authorized = None;

        authorize_selected_asset(&spritesheet, |path: &Path| {
            authorized = Some(path.to_path_buf());
            Ok::<(), &str>(())
        })
        .unwrap();

        assert_eq!(authorized, Some(spritesheet));
    }
}
