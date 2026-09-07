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
    /// Single-pet mode: the desktop shows exactly one pet. The list shape is
    /// kept for settings-file compatibility with older releases that allowed
    /// several pets; loading now truncates it to the first entry.
    #[serde(default)]
    pub selected_pets: Vec<SelectedPet>,
    pub pet: PetSettings,
    #[serde(default)]
    pub random_activity: RandomActivitySettings,
    pub reminders: Vec<Reminder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_pets_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivityAction {
    Waving,
    Jumping,
    Waiting,
    Running,
    Review,
    Failed,
}

impl ActivityAction {
    pub fn animation(self) -> &'static str {
        match self {
            Self::Waving => "waving",
            Self::Jumping => "jumping",
            Self::Waiting => "waiting",
            Self::Running => "running",
            Self::Review => "review",
            Self::Failed => "failed",
        }
    }

    pub fn duration_ms(self) -> u64 {
        // Two complete cycles of the shared v1/v2 rows in domain/pets.ts.
        2 * match self {
            Self::Waving => 700,
            Self::Jumping => 840,
            Self::Waiting => 1010,
            Self::Running => 820,
            Self::Review => 1030,
            Self::Failed => 1220,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActivityFrequency {
    Quiet,
    Normal,
    Active,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomActivitySettings {
    pub enabled: bool,
    pub frequency: ActivityFrequency,
    pub custom_min_seconds: u32,
    pub custom_max_seconds: u32,
    pub enabled_actions: Vec<ActivityAction>,
}

impl Default for RandomActivitySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            frequency: ActivityFrequency::Normal,
            custom_min_seconds: 30,
            custom_max_seconds: 90,
            enabled_actions: vec![
                ActivityAction::Waving,
                ActivityAction::Jumping,
                ActivityAction::Waiting,
                ActivityAction::Review,
            ],
        }
    }
}

impl RandomActivitySettings {
    pub fn interval_seconds(&self) -> (u32, u32) {
        match self.frequency {
            ActivityFrequency::Quiet => (120, 300),
            ActivityFrequency::Normal => (30, 90),
            ActivityFrequency::Active => (10, 30),
            ActivityFrequency::Custom => (self.custom_min_seconds, self.custom_max_seconds),
        }
    }
}

impl<'de> Deserialize<'de> for RandomActivitySettings {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // A malformed/unknown activity field must never reset the user's pet,
        // scale or reminders. Missing fields migrate independently.
        let value = Value::deserialize(deserializer)?;
        let mut result = Self::default();
        if let Some(enabled) = value.get("enabled").and_then(Value::as_bool) {
            result.enabled = enabled;
        }
        if let Some(frequency) = value.get("frequency") {
            result.frequency =
                serde_json::from_value(frequency.clone()).unwrap_or(ActivityFrequency::Normal);
        }
        let min = value
            .get("customMinSeconds")
            .unwrap_or(&Value::Null)
            .clone();
        let max = value
            .get("customMaxSeconds")
            .unwrap_or(&Value::Null)
            .clone();
        let min = if min.is_null() {
            Some(30)
        } else {
            min.as_u64()
        };
        let max = if max.is_null() {
            Some(90)
        } else {
            max.as_u64()
        };
        if let (Some(min), Some(max)) = (min, max) {
            if min >= 1 && max <= 3600 && min <= max {
                result.custom_min_seconds = min as u32;
                result.custom_max_seconds = max as u32;
            }
        }
        if let Some(actions) = value.get("enabledActions").and_then(Value::as_array) {
            result.enabled_actions.clear();
            for action in actions {
                if let Ok(action) = serde_json::from_value::<ActivityAction>(action.clone()) {
                    if !result.enabled_actions.contains(&action) {
                        result.enabled_actions.push(action);
                    }
                }
            }
        }
        Ok(result)
    }
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
        self.pet.scale = self.pet.scale.clamp(0.1, 10.0);
        self.pet.speed = self.pet.speed.clamp(40.0, 140.0);
        // Single-pet mode: keep the first valid entry of a legacy multi-pet
        // list (the primary pet), falling back to the legacy single selection
        // or the default pet.
        self.selected_pets
            .retain(|pet| !pet.id.trim().is_empty() && !pet.version.trim().is_empty());
        self.selected_pets.truncate(1);
        if self.selected_pets.is_empty() {
            let fallback_valid = !self.selected_pet.id.trim().is_empty()
                && !self.selected_pet.version.trim().is_empty();
            self.selected_pets = vec![if fallback_valid {
                self.selected_pet.clone()
            } else {
                SelectedPet {
                    id: "yanghao".into(),
                    version: "1.0.0".into(),
                }
            }];
        }
        self.selected_pet = self.selected_pets[0].clone();
        self.reminders.retain(|item| {
            !item.id.trim().is_empty()
                && !item.title.trim().is_empty()
                && match &item.schedule {
                    ReminderSchedule::Interval { minutes } => (1..=1_440).contains(minutes),
                    ReminderSchedule::Daily { at } => valid_daily_time(at),
                }
        });
        for item in &mut self.reminders {
            // Keep a user-chosen snooze length within a sane range instead of
            // flattening every reminder back to the 5-minute default.
            item.snooze_minutes = item.snooze_minutes.clamp(1, 30);
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
        serde_json::from_value::<SettingsV1>(value)
            .unwrap_or_default()
            .sanitize()
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
        // A patch that no longer parses as settings must fail loudly: silently
        // keeping the old value would make the UI claim a save that never
        // reached the disk.
        let next = serde_json::from_value::<SettingsV1>(merged)
            .map_err(|error| io::Error::other(format!("invalid settings patch: {error}")))?
            .sanitize();
        self.save(&next)?;
        Ok(next)
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
        // NOTE: `selectedPets` is intentionally absent here. Legacy settings
        // files only carry `selectedPet`; if the defaults injected a
        // `selectedPets` list, merge_json would keep it and sanitize() would
        // never migrate the user's legacy single selection.
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
    fn activity_migration_preserves_existing_settings_and_empty_selection() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("settings.json"));
        store.save_value(&json!({ "schemaVersion": 1, "pet": { "scale": 0.8, "roamingEnabled": false }, "selectedPet": { "id": "bear", "version": "local" } })).unwrap();
        let old = store.load();
        assert!(!old.random_activity.enabled);
        assert_eq!(old.pet.scale, 0.8);
        assert_eq!(old.selected_pet.id, "bear");
        let next = store.patch(&old, json!({ "randomActivity": { "enabled": true, "enabledActions": ["unknown"], "frequency": "custom", "customMinSeconds": 5, "customMaxSeconds": 5 } })).unwrap();
        assert!(next.random_activity.enabled_actions.is_empty());
        assert_eq!(next.random_activity.interval_seconds(), (5, 5));
        assert_eq!(store.load().random_activity, next.random_activity);
        assert_eq!(next.pet.scale, 0.8);
        assert_eq!(next.selected_pet, old.selected_pet);
        assert_eq!(next.reminders.len(), old.reminders.len());
    }

    #[test]
    fn malformed_activity_fields_do_not_reset_unrelated_preferences() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("settings.json"));
        let value = store.patch(&store.load(), json!({ "pet": { "scale": 0.8 }, "randomActivity": { "frequency": "future", "customMinSeconds": 2.5, "customMaxSeconds": 1, "enabledActions": ["waving", "waving", "unknown", 7] } })).unwrap();
        assert_eq!(value.pet.scale, 0.8);
        assert_eq!(value.random_activity.interval_seconds(), (30, 90));
        assert_eq!(value.random_activity.custom_min_seconds, 30);
        assert_eq!(
            value.random_activity.enabled_actions,
            vec![super::ActivityAction::Waving]
        );
    }

    #[test]
    fn falls_back_to_defaults_when_json_is_corrupt() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        std::fs::write(&path, "{broken").unwrap();
        let loaded = SettingsStore::new(path).load_value();
        assert_eq!(loaded["schemaVersion"], 1);
        assert_eq!(loaded["pet"]["speed"].as_f64(), Some(80.0));
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
        value["pet"]["scale"] = json!(0.05);
        store.save_value(&value).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.pet.speed, 140.0);
        assert_eq!(loaded.pet.scale, 0.1);
    }

    #[test]
    fn caps_oversized_pet_scale_at_one_thousand_percent() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("settings.json"));
        let mut value = store.load_value();
        value["pet"]["scale"] = json!(15);
        store.save_value(&value).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.pet.scale, 10.0);
    }

    #[test]
    fn migrates_legacy_single_selection_into_selected_pets() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("settings.json"));
        let mut value = store.load_value();
        value["selectedPet"] = json!({ "id": "lev-neon", "version": "1.0.0" });
        value.as_object_mut().unwrap().remove("selectedPets");
        store.save_value(&value).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.selected_pets.len(), 1);
        assert_eq!(loaded.selected_pets[0].id, "lev-neon");
        assert_eq!(loaded.selected_pet.id, "lev-neon");
    }

    #[test]
    fn truncates_a_legacy_multi_pet_list_to_the_primary_pet() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("settings.json"));
        let mut value = store.load_value();
        value["selectedPets"] = json!([
            { "id": "lev-neon", "version": "1.0.0" },
            { "id": "yanghao", "version": "1.0.0" },
            { "id": "", "version": "1.0.0" }
        ]);
        store.save_value(&value).unwrap();
        let loaded = store.load();
        // Single-pet mode: only the first valid entry survives the upgrade.
        assert_eq!(loaded.selected_pets.len(), 1);
        assert_eq!(loaded.selected_pets[0].id, "lev-neon");
        assert_eq!(loaded.selected_pet.id, "lev-neon");
    }

    #[test]
    fn patch_rejects_an_unparseable_merge_instead_of_reverting_silently() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("settings.json"));
        let current = store.load();
        let result = store.patch(&current, json!({ "pet": { "speed": "not-a-number" } }));
        assert!(result.is_err());
    }

    #[test]
    fn keeps_a_valid_snooze_length_and_clamps_out_of_range_values() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().join("settings.json"));
        let mut value = store.load_value();
        value["reminders"][0]["snoozeMinutes"] = json!(10);
        value["reminders"][1]["snoozeMinutes"] = json!(99);
        store.save_value(&value).unwrap();
        let loaded = store.load();
        assert_eq!(loaded.reminders[0].snooze_minutes, 10);
        assert_eq!(loaded.reminders[1].snooze_minutes, 30);
    }
}
