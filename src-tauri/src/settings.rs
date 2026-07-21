use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsV1 {
    pub schema_version: u8,
    pub onboarding_complete: bool,
    pub autostart_enabled: bool,
    pub selected_pet: SelectedPet,
    pub pet: PetSettings,
    pub reminders: Vec<Reminder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedPet {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSettings {
    pub scale: f64,
    pub speed: f64,
    pub roaming_enabled: bool,
    pub always_on_top: bool,
    pub hide_in_fullscreen: bool,
    pub click_through: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub title: String,
    pub message: String,
    pub enabled: bool,
    pub schedule: ReminderSchedule,
    pub snooze_minutes: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReminderSchedule {
    Interval { minutes: u32 },
    Daily { at: String },
}

impl Default for SettingsV1 {
    fn default() -> Self {
        serde_json::from_value(default_value()).expect("built-in settings must be valid")
    }
}

impl SettingsV1 {
    pub fn sanitize(mut self) -> Self {
        if self.schema_version != 1 {
            return Self::default();
        }
        self.pet.scale = self.pet.scale.clamp(0.75, 1.5);
        self.pet.speed = self.pet.speed.clamp(40.0, 140.0);
        self.reminders.retain(|item| {
            !item.id.trim().is_empty()
                && !item.title.trim().is_empty()
                && match &item.schedule {
                    ReminderSchedule::Interval { minutes } => (1..=1_440).contains(minutes),
                    ReminderSchedule::Daily { at } => valid_daily_time(at),
                }
        });
        for item in &mut self.reminders {
            item.snooze_minutes = 5;
        }
        if self.reminders.is_empty() {
            self.reminders = Self::default().reminders;
        }
        self
    }
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn load(&self) -> SettingsV1 {
        let value = self.load_value();
        serde_json::from_value(value).unwrap_or_default().sanitize()
    }

    pub fn load_value(&self) -> Value {
        let Ok(contents) = fs::read_to_string(&self.path) else {
            return default_value();
        };
        let Ok(mut loaded) = serde_json::from_str::<Value>(&contents) else {
            self.preserve_corrupt_file();
            return default_value();
        };
        if loaded.get("schemaVersion") != Some(&json!(1)) {
            return default_value();
        }
        let mut defaults = default_value();
        merge_json(&mut defaults, loaded.take());
        serde_json::to_value(
            serde_json::from_value::<SettingsV1>(defaults)
                .unwrap_or_default()
                .sanitize(),
        )
        .expect("settings serialization cannot fail")
    }

    pub fn save(&self, value: &SettingsV1) -> io::Result<()> {
        self.save_value(&serde_json::to_value(value).map_err(io::Error::other)?)
    }

    pub fn save_value(&self, value: &Value) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temp = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
        {
            let mut file = fs::File::create(&temp)?;
            use io::Write;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        atomic_replace(&temp, &self.path)
    }

    pub fn patch(&self, current: &SettingsV1, patch: Value) -> io::Result<SettingsV1> {
        let mut merged = serde_json::to_value(current).map_err(io::Error::other)?;
        merge_json(&mut merged, patch);
        let next = serde_json::from_value::<SettingsV1>(merged)
            .unwrap_or_else(|_| current.clone())
            .sanitize();
        self.save(&next)?;
        Ok(next)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn preserve_corrupt_file(&self) {
        let stamp = chrono::Utc::now().timestamp();
        let backup = self
            .path
            .with_file_name(format!("settings.corrupt-{stamp}.json"));
        let _ = fs::rename(&self.path, backup);
    }
}

fn default_value() -> Value {
    json!({
        "schemaVersion": 1,
        "onboardingComplete": false,
        "autostartEnabled": true,
        "selectedPet": { "id": "yanghao", "version": "1.0.0" },
        "pet": {
            "scale": 1.0,
            "speed": 80.0,
            "roamingEnabled": true,
            "alwaysOnTop": true,
            "hideInFullscreen": true,
            "clickThrough": false
        },
        "reminders": [
            { "id": "eye-rest", "title": "看看远处", "message": "让眼睛休息 20 秒", "enabled": true, "schedule": { "kind": "interval", "minutes": 20 }, "snoozeMinutes": 5 },
            { "id": "water", "title": "喝口水吧", "message": "补充一点水分", "enabled": true, "schedule": { "kind": "interval", "minutes": 45 }, "snoozeMinutes": 5 },
            { "id": "stretch", "title": "起来走走吧", "message": "活动一下肩颈和双腿", "enabled": true, "schedule": { "kind": "interval", "minutes": 60 }, "snoozeMinutes": 5 }
        ]
    })
}

fn merge_json(target: &mut Value, patch: Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                if let Some(existing) = target.get_mut(&key) {
                    merge_json(existing, value);
                } else {
                    target.insert(key, value);
                }
            }
        }
        (target, value) => *target = value,
    }
}

fn valid_daily_time(value: &str) -> bool {
    let Some((hour, minute)) = value.split_once(':') else {
        return false;
    };
    hour.len() == 2
        && minute.len() == 2
        && hour.parse::<u8>().is_ok_and(|value| value < 24)
        && minute.parse::<u8>().is_ok_and(|value| value < 60)
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(io::Error::other)
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::SettingsStore;
    use serde_json::json;

    #[test]
    fn falls_back_to_defaults_when_json_is_corrupt() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        std::fs::write(&path, "{broken").unwrap();
        let loaded = SettingsStore::new(path).load_value();
        assert_eq!(loaded["schemaVersion"], 1);
        assert_eq!(loaded["pet"]["speed"], 80);
    }

    #[test]
    fn saves_with_atomic_replacement_and_no_temp_residue() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let store = SettingsStore::new(&path);
        store
            .save_value(&json!({"schemaVersion": 1, "answer": 42}))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(path).unwrap())
                .unwrap()["answer"],
            42
        );
        assert!(!directory.path().join("settings.json.tmp").exists());
    }

    #[test]
    fn clamps_untrusted_numeric_settings() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("settings.json"));
        let mut value = store.load_value();
        value["pet"]["speed"] = json!(900);
        value["pet"]["scale"] = json!(0.1);
        store.save_value(&value).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.pet.speed, 140.0);
        assert_eq!(loaded.pet.scale, 0.75);
    }
}
