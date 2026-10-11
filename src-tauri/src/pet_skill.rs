use std::{io::Write, path::Path};

const FILES: &[(&str, &[u8])] = &[
    (
        "SKILL.md",
        include_bytes!("../../skills/deskmate-create-pet/SKILL.md"),
    ),
    (
        "references/atlas.md",
        include_bytes!("../../skills/deskmate-create-pet/references/atlas.md"),
    ),
    (
        "assets/pet.template.json",
        include_bytes!("../../skills/deskmate-create-pet/assets/pet.template.json"),
    ),
    (
        "agents/openai.yaml",
        include_bytes!("../../skills/deskmate-create-pet/agents/openai.yaml"),
    ),
    (
        "scripts/pet_tools.py",
        include_bytes!("../../skills/deskmate-create-pet/scripts/pet_tools.py"),
    ),
];

pub fn export(path: &Path) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    for (name, content) in FILES {
        zip.start_file(
            format!("deskmate-create-pet/{name}"),
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .map_err(|e| e.to_string())?;
        zip.write_all(content).map_err(|e| e.to_string())?;
    }
    zip.finish()
        .map_err(|e| e.to_string())?
        .sync_all()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn skill_exports_without_a_network_request() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("skill.zip");
        export(&path).unwrap();
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        assert_eq!(zip.len(), FILES.len());
        assert!(
            zip.by_name("deskmate-create-pet/scripts/pet_tools.py")
                .unwrap()
                .size()
                > 0
        );
    }
}
