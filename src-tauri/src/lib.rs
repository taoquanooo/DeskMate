mod motion;
mod pet_asset_scope;
mod pets;
mod reminders;
mod runtime;
mod settings;

use futures_util::StreamExt;
use pets::{LocalPetScanV1, PetCatalogEntryV1, PetCatalogV1};
use serde::Serialize;
use settings::{SelectedPet, SettingsStore, SettingsV1, MAX_ACTIVE_PETS};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Duration,
};
use tauri::{Emitter, Listener, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_updater::UpdaterExt;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_CATALOG_BYTES: usize = 2 * 1024 * 1024;
const MAX_PET_PACKAGE_BYTES: u64 = 25 * 1024 * 1024;
const PROJECT_URL: &str = "https://github.com/taoquanooo/DeskMate";
const PET_GALLERY_URL: &str = "https://codex-pet.org/zh/";
const PETDEX_URL: &str = "https://petdex.dev/";
const BUILT_IN_PETS: [(&str, &str, u8); 2] = [("yanghao", "1.0.0", 2), ("lev-neon", "1.0.0", 2)];
const PETS_RELEASE_TAG: &str = "pets-v1";
const CATALOG_ASSET_NAME: &str = "catalog.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgressPayload {
    id: String,
    version: String,
    downloaded: u64,
    total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPetV1 {
    id: String,
    version: String,
    display_name: String,
    sprite_version_number: u8,
    spritesheet_path: String,
}

pub struct AppState {
    settings: Mutex<SettingsV1>,
    settings_store: SettingsStore,
    catalog: RwLock<Option<PetCatalogV1>>,
    data_dir: PathBuf,
    custom_pets_dir: RwLock<PathBuf>,
    client: reqwest::Client,
    paused: AtomicBool,
    fullscreen: AtomicBool,
    // Per-pet-window flags, keyed by window label ("pet", "pet-2", ...), so
    // each desktop pet can be dragged or interacted with independently.
    dragging: Mutex<HashMap<String, bool>>,
    interacting: Mutex<HashMap<String, bool>>,
    moving: Mutex<HashMap<String, bool>>,
    pet_engines: Mutex<HashSet<String>>,
    ready_update: Mutex<Option<ReadyUpdate>>,
    install_lock: tokio::sync::Mutex<()>,
}

pub(crate) fn window_flag(flags: &Mutex<HashMap<String, bool>>, label: &str) -> bool {
    flags
        .lock()
        .map(|flags| flags.get(label).copied().unwrap_or(false))
        .unwrap_or(false)
}

pub(crate) fn set_window_flag(flags: &Mutex<HashMap<String, bool>>, label: &str, value: bool) {
    if let Ok(mut flags) = flags.lock() {
        flags.insert(label.to_string(), value);
    }
}

pub(crate) fn any_window_flag(flags: &Mutex<HashMap<String, bool>>) -> bool {
    flags
        .lock()
        .map(|flags| flags.values().any(|value| *value))
        .unwrap_or(false)
}

/// Window label for the pet slot at `index` (the first pet uses the static
/// "pet" window declared in tauri.conf.json).
fn pet_window_label(index: usize) -> String {
    if index == 0 {
        "pet".to_string()
    } else {
        format!("pet-{}", index + 1)
    }
}

/// Inverse of `pet_window_label`; returns None for non-pet windows.
fn pet_window_index(label: &str) -> Option<usize> {
    if label == "pet" {
        return Some(0);
    }
    let number: usize = label.strip_prefix("pet-")?.parse().ok()?;
    // "pet-2" is slot 1, "pet-3" is slot 2, ... ("pet-1" is not a valid slot:
    // the first pet always uses the static "pet" window).
    number.checked_sub(1).filter(|index| *index >= 1)
}

#[derive(Clone)]
struct ReadyUpdate {
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetChangedPayload {
    id: String,
    version: String,
    sprite_version_number: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    spritesheet_path: Option<PathBuf>,
}

#[derive(serde::Deserialize)]
struct WindowFlagPayload {
    label: String,
    value: bool,
}

#[tauri::command]
fn settings_get(state: tauri::State<'_, AppState>) -> SettingsV1 {
    state.settings.lock().expect("settings poisoned").clone()
}

#[tauri::command]
fn settings_patch(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<SettingsV1, String> {
    let current = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?
        .clone();
    let next = state
        .settings_store
        .patch(&current, patch)
        .map_err(|error| error.to_string())?;
    apply_window_settings(&app, &next);
    *state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")? = next.clone();
    Ok(next)
}

#[tauri::command]
fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn pet_catalog_refresh(app: tauri::AppHandle) -> Result<PetCatalogV1, String> {
    refresh_catalog(&app).await
}

#[tauri::command]
async fn pet_install(app: tauri::AppHandle, id: String, version: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let cached_catalog = state
        .catalog
        .read()
        .map_err(|_| "catalog lock poisoned")?
        .clone();
    let catalog = match cached_catalog {
        Some(catalog) => catalog,
        None => refresh_catalog(&app).await?,
    };
    let entry = catalog
        .pets
        .into_iter()
        .find(|entry| entry.id == id && entry.version == version)
        .ok_or_else(|| format!("{id}@{version} is not in the official catalog"))?;
    install_entry(&app, &entry).await
}

#[tauri::command]
async fn installed_pets(app: tauri::AppHandle) -> Result<Vec<InstalledPetV1>, String> {
    // Same pre-manage race as `pet_local_refresh`: the settings window can
    // invoke this on mount before `app.manage(AppState)` has run. Without
    // managed state there is no data dir yet, so return an empty list rather
    // than panicking under `panic = "abort"`.
    let pets_root = match app.try_state::<AppState>() {
        Some(state) => state.data_dir.join("pets"),
        None => return Ok(Vec::new()),
    };
    tauri::async_runtime::spawn_blocking(move || scan_installed_pets(&pets_root))
        .await
        .map_err(|error| format!("扫描已安装宠物失败：{error}"))?
}

#[tauri::command]
async fn pet_uninstall(app: tauri::AppHandle, id: String, version: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let deleted_dir = if version == "local" {
        // Custom pet: find the folder by scanning the custom pets directory.
        let custom_root = state
            .custom_pets_dir
            .read()
            .map_err(|_| "custom_pets_dir lock poisoned")?
            .clone();
        let scan =
            tauri::async_runtime::spawn_blocking(move || pets::scan_local_pets(&custom_root))
                .await
                .map_err(|error| format!("扫描自定义宠物失败：{error}"))?;
        let pet = scan
            .pets
            .into_iter()
            .find(|pet| pet.id == id)
            .ok_or_else(|| format!("找不到本地宠物 {id}"))?;
        let dir = state
            .custom_pets_dir
            .read()
            .map_err(|_| "custom_pets_dir lock poisoned")?
            .join(&pet.folder_name);
        dir
    } else {
        state.data_dir.join("pets").join(&id).join(&version)
    };
    tauri::async_runtime::spawn_blocking(move || {
        if deleted_dir.exists() {
            std::fs::remove_dir_all(&deleted_dir).map_err(|error| format!("删除失败：{error}"))?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("删除任务失败：{error}"))??;
    // If the deleted pet was on the desktop, drop it from the selection; when
    // nothing is left, fall back to the default companion.
    let selection_changed = {
        let mut settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned")?;
        let before = settings.selected_pets.clone();
        settings
            .selected_pets
            .retain(|pet| !(pet.id == id && pet.version == version));
        if settings.selected_pets.is_empty() {
            settings.selected_pets.push(SelectedPet {
                id: "yanghao".into(),
                version: "1.0.0".into(),
            });
        }
        settings.selected_pet = settings.selected_pets[0].clone();
        let changed = settings.selected_pets != before;
        if changed {
            state
                .settings_store
                .save(&settings)
                .map_err(|error| error.to_string())?;
        }
        changed
    };
    if selection_changed {
        sync_pet_windows(&app)?;
    }
    let _ = app.emit(
        "pet://uninstalled",
        serde_json::json!({ "id": id, "version": version }),
    );
    Ok(())
}

fn scan_installed_pets(pets_root: &Path) -> Result<Vec<InstalledPetV1>, String> {
    let mut installed = Vec::new();
    let id_entries = match std::fs::read_dir(pets_root) {
        Ok(entries) => entries,
        Err(_) => return Ok(installed),
    };
    for id_entry in id_entries.filter_map(Result::ok) {
        if !id_entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        let version_entries = match std::fs::read_dir(id_entry.path()) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for version_entry in version_entries.filter_map(Result::ok) {
            if !version_entry
                .file_type()
                .map(|file_type| file_type.is_dir())
                .unwrap_or(false)
            {
                continue;
            }
            let version = version_entry.file_name().to_string_lossy().into_owned();
            match pets::load_pet_directory(&version_entry.path()) {
                Ok((manifest, spritesheet)) => {
                    installed.push(InstalledPetV1 {
                        id: manifest.id,
                        version,
                        display_name: manifest.display_name,
                        sprite_version_number: manifest.sprite_version_number,
                        spritesheet_path: spritesheet.display().to_string(),
                    });
                }
                Err(_) => continue,
            }
        }
    }
    Ok(installed)
}

#[tauri::command]
fn pet_selection_set(
    app: tauri::AppHandle,
    pets: Vec<SelectedPet>,
) -> Result<Vec<SelectedPet>, String> {
    let mut deduped: Vec<SelectedPet> = Vec::new();
    for pet in pets {
        if pet.id.trim().is_empty() || pet.version.trim().is_empty() {
            return Err("桌宠选择包含无效的 id 或版本".into());
        }
        if deduped
            .iter()
            .any(|existing| existing.id == pet.id && existing.version == pet.version)
        {
            continue;
        }
        // Resolve every pet before committing so a missing package can't
        // leave the desktop with a half-applied selection.
        resolve_pet_payload(&app, &pet.id, &pet.version)
            .map_err(|error| format!("{}@{}：{error}", pet.id, pet.version))?;
        deduped.push(pet);
    }
    if deduped.is_empty() {
        return Err("至少保留一只桌宠".into());
    }
    if deduped.len() > MAX_ACTIVE_PETS {
        return Err(format!("最多同时显示 {MAX_ACTIVE_PETS} 只桌宠"));
    }
    {
        let state = app.state::<AppState>();
        let mut settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned")?;
        settings.selected_pets = deduped.clone();
        settings.selected_pet = deduped[0].clone();
        state
            .settings_store
            .save(&settings)
            .map_err(|error| error.to_string())?;
    }
    sync_pet_windows(&app)?;
    Ok(deduped)
}

#[tauri::command]
async fn pet_local_refresh(app: tauri::AppHandle) -> LocalPetScanV1 {
    // Same pre-manage race as `pet_current`: the settings window can invoke
    // this on mount before `app.manage(AppState)` has run. Without managed
    // state there is no data dir yet, so return an empty scan rather than
    // panicking under `panic = "abort"`.
    let root = match app.try_state::<AppState>() {
        Some(state) => state
            .custom_pets_dir
            .read()
            .expect("custom_pets_dir lock poisoned")
            .clone(),
        None => {
            return LocalPetScanV1 {
                folder_path: String::new(),
                pets: Vec::new(),
                errors: Vec::new(),
            }
        }
    };
    match tauri::async_runtime::spawn_blocking(move || pets::scan_local_pets(&root)).await {
        Ok(mut scan) => {
            let mut authorized = Vec::with_capacity(scan.pets.len());
            for pet in scan.pets {
                match app.asset_protocol_scope().allow_file(&pet.spritesheet_path) {
                    Ok(()) => authorized.push(pet),
                    Err(error) => scan
                        .errors
                        .push(format!("{}：无法授权预览图集（{error}）", pet.folder_name)),
                }
            }
            scan.pets = authorized;
            scan
        }
        Err(_) => LocalPetScanV1 {
            folder_path: String::new(),
            pets: Vec::new(),
            errors: vec!["自定义宠物扫描被中断".into()],
        },
    }
}

#[tauri::command]
fn pet_local_folder_open(app: tauri::AppHandle) -> Result<(), String> {
    let root = custom_pets_root(&app);
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    std::process::Command::new("explorer.exe")
        .arg(root)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开自定义宠物文件夹：{error}"))
}

#[tauri::command]
async fn custom_pets_dir_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择自定义宠物文件夹")
            .pick_folder()
    })
    .await
    .map_err(|error| format!("文件夹选择器出错：{error}"))?;
    let Some(path) = picked else {
        return Ok(None);
    };
    std::fs::create_dir_all(&path).map_err(|error| format!("无法创建文件夹：{error}"))?;
    let path_string = path.display().to_string();
    let state = app.state::<AppState>();
    {
        let mut settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned")?;
        settings.custom_pets_dir = Some(path_string.clone());
        state
            .settings_store
            .save(&settings)
            .map_err(|error| error.to_string())?;
    }
    *state
        .custom_pets_dir
        .write()
        .map_err(|_| "custom_pets_dir lock poisoned")? = path;
    Ok(Some(path_string))
}

#[tauri::command]
async fn pet_current(app: tauri::AppHandle, window: tauri::Window) -> PetChangedPayload {
    let fallback = PetChangedPayload {
        id: "yanghao".into(),
        version: "1.0.0".into(),
        sprite_version_number: 2,
        spritesheet_path: None,
    };
    // The pet window's frontend invokes `pet_current` on mount. Tauri creates
    // config windows before running the `setup()` closure that calls
    // `app.manage(AppState)`, so this command can race ahead of manage() and
    // must not panic when the state is not yet available (`panic = "abort"`
    // would otherwise kill the process instantly). Fall back to the default
    // pet; once setup completes, later invocations resolve the real selection.
    let selected = {
        let Some(state) = app.try_state::<AppState>() else {
            return fallback;
        };
        let settings = state.settings.lock().expect("settings poisoned").clone();
        // Each pet window renders its own slot of the selection; non-pet
        // windows (e.g. the settings preview) show the primary pet.
        let index = pet_window_index(window.label()).unwrap_or(0);
        settings
            .selected_pets
            .get(index)
            .or_else(|| settings.selected_pets.first())
            .cloned()
            .unwrap_or(settings.selected_pet)
    };
    let fallback_for_task = fallback.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        resolve_pet_payload(&app, &selected.id, &selected.version).unwrap_or(fallback_for_task)
    })
    .await
    {
        Ok(payload) => payload,
        Err(_) => fallback,
    }
}

#[tauri::command]
fn project_url_open() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(PROJECT_URL)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开 GitHub：{error}"))
}

#[tauri::command]
fn project_share_copy() -> Result<(), String> {
    use std::io::Write as _;

    let mut child = std::process::Command::new("clip.exe")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Windows 剪贴板：{error}"))?;
    let mut stdin = child.stdin.take().ok_or("无法连接 Windows 剪贴板")?;
    stdin
        .write_all(PROJECT_URL.as_bytes())
        .map_err(|error| format!("无法复制分享链接：{error}"))?;
    drop(stdin);
    let status = child
        .wait()
        .map_err(|error| format!("无法完成复制：{error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Windows 剪贴板未能复制分享链接".into())
    }
}

#[tauri::command]
fn pet_gallery_url_open() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(PET_GALLERY_URL)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开 Codex Pet Gallery：{error}"))
}

#[tauri::command]
fn petdex_url_open() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(PETDEX_URL)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开 PetDex：{error}"))
}

#[tauri::command]
fn pet_recall(app: tauri::AppHandle) -> Result<(), String> {
    runtime::recall_to_cursor_monitor(&app)
}

#[tauri::command]
fn window_set_click_through(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    set_click_through(&app, enabled)
}

#[tauri::command]
async fn updater_check(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    check_for_update(&app).await
}

#[tauri::command]
async fn updater_install(app: tauri::AppHandle) -> Result<(), String> {
    let ready = app
        .state::<AppState>()
        .ready_update
        .lock()
        .map_err(|_| "updater lock poisoned")?
        .clone()
        .ok_or("no downloaded update is ready")?;
    ready
        .update
        .install(&ready.bytes)
        .map_err(|error| error.to_string())?;
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_settings(app)
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let settings_store = SettingsStore::new(data_dir.join("settings.json"));
            let settings = settings_store.load();
            // Resolve the custom-pets directory: use the user-configured path if
            // set, otherwise default to a "custom-pets" folder next to the exe
            // (more discoverable than the AppData location).  If the exe-adjacent
            // path cannot be created (e.g. C:\Program Files with strict ACLs),
            // fall back to the data dir so the app still works.
            let custom_pets_dir = if let Some(dir) = settings.custom_pets_dir.as_ref() {
                let path = PathBuf::from(dir);
                let _ = std::fs::create_dir_all(&path);
                path
            } else {
                let default_dir = exe_dir().join("custom-pets");
                if std::fs::create_dir_all(&default_dir).is_ok() {
                    // Migrate pets from the old AppData location if the new dir
                    // is empty and the old one exists.
                    let old_dir = data_dir.join("custom-pets");
                    if old_dir.is_dir() {
                        let has_pets = std::fs::read_dir(&default_dir)
                            .map(|mut entries| entries.next().is_some())
                            .unwrap_or(false);
                        if !has_pets {
                            let _ = std::fs::rename(&old_dir, &default_dir);
                        }
                    }
                    default_dir
                } else {
                    let fallback = data_dir.join("custom-pets");
                    let _ = std::fs::create_dir_all(&fallback);
                    fallback
                }
            };
            let catalog = load_cached_catalog(&data_dir);
            let reminder_runtime = Arc::new(reminders::ReminderRuntime::default());
            reminder_runtime.initialize(&settings.reminders);
            app.manage(AppState {
                settings: Mutex::new(settings.clone()),
                settings_store,
                catalog: RwLock::new(catalog),
                data_dir,
                custom_pets_dir: RwLock::new(custom_pets_dir),
                client: reqwest::Client::builder()
                    .user_agent(format!("DeskMate/{APP_VERSION}"))
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(45))
                    .redirect(reqwest::redirect::Policy::limited(5))
                    .build()?,
                paused: AtomicBool::new(false),
                fullscreen: AtomicBool::new(false),
                dragging: Mutex::new(HashMap::new()),
                interacting: Mutex::new(HashMap::new()),
                moving: Mutex::new(HashMap::new()),
                pet_engines: Mutex::new(HashSet::new()),
                ready_update: Mutex::new(None),
                install_lock: tokio::sync::Mutex::new(()),
            });

            let drag_app = app.handle().clone();
            app.listen("runtime://dragging", move |event| {
                if let Ok(payload) = serde_json::from_str::<WindowFlagPayload>(event.payload()) {
                    set_window_flag(
                        &drag_app.state::<AppState>().dragging,
                        &payload.label,
                        payload.value,
                    );
                }
            });
            let interaction_app = app.handle().clone();
            app.listen("runtime://interaction", move |event| {
                if let Ok(payload) = serde_json::from_str::<WindowFlagPayload>(event.payload()) {
                    set_window_flag(
                        &interaction_app.state::<AppState>().interacting,
                        &payload.label,
                        payload.value,
                    );
                }
            });

            if let Err(error) = app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            )) {
                eprintln!("autostart plugin failed to initialize: {error}");
            }
            if let Err(error) = register_shortcuts(app) {
                eprintln!("global shortcuts failed to register: {error}");
            }
            create_tray(app)?;
            apply_window_settings(app.handle(), &settings);
            // Sync one window per saved pet and emit each window its payload so
            // the pet windows pick up the saved selection even if their initial
            // petCurrent() calls raced ahead of app.manage(AppState).
            if let Err(error) = sync_pet_windows(app.handle()) {
                eprintln!("failed to sync pet windows: {error}");
            }
            if let Some(settings_window) = app.get_webview_window("settings") {
                let window = settings_window.clone();
                settings_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
                if settings.onboarding_complete {
                    let _ = settings_window.hide();
                }
            }
            runtime::start_motion_engine(app.handle().clone());
            reminders::start(app.handle().clone(), reminder_runtime);
            start_online_refreshes(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings_get,
            settings_patch,
            autostart_set,
            pet_catalog_refresh,
            pet_install,
            installed_pets,
            pet_uninstall,
            pet_selection_set,
            pet_local_refresh,
            pet_local_folder_open,
            custom_pets_dir_pick,
            pet_current,
            pet_recall,
            project_url_open,
            project_share_copy,
            pet_gallery_url_open,
            petdex_url_open,
            window_set_click_through,
            updater_check,
            updater_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskMate");
}

#[cfg(test)]
mod tests {
    use super::{github_release_download_parts, repository_slug};

    #[test]
    fn parses_github_release_download_urls() {
        let url = url::Url::parse(
            "https://github.com/taoquanooo/DeskMate/releases/download/pets-v1/lansha-1.0.0.zip",
        )
        .unwrap();
        let (repository, tag, asset) = github_release_download_parts(&url).unwrap();
        assert_eq!(repository, "taoquanooo/DeskMate");
        assert_eq!(tag, "pets-v1");
        assert_eq!(asset, "lansha-1.0.0.zip");
    }

    #[test]
    fn rejects_non_release_download_urls() {
        let url = url::Url::parse("https://example.com/releases/download/pets-v1/x.zip").unwrap();
        assert!(github_release_download_parts(&url).is_none());
        let url = url::Url::parse("https://github.com/taoquanooo/DeskMate").unwrap();
        assert!(github_release_download_parts(&url).is_none());
    }

    #[test]
    fn derives_repository_slug_from_project_url() {
        assert_eq!(repository_slug(), "taoquanooo/DeskMate");
    }

    #[test]
    fn pet_window_labels_round_trip() {
        assert_eq!(super::pet_window_label(0), "pet");
        assert_eq!(super::pet_window_label(1), "pet-2");
        assert_eq!(super::pet_window_label(3), "pet-4");
        assert_eq!(super::pet_window_index("pet"), Some(0));
        assert_eq!(super::pet_window_index("pet-2"), Some(1));
        assert_eq!(super::pet_window_index("pet-4"), Some(3));
        assert_eq!(super::pet_window_index("pet-1"), None);
        assert_eq!(super::pet_window_index("settings"), None);
    }
}

fn apply_window_settings(app: &tauri::AppHandle, settings: &SettingsV1) {
    for (label, pet) in app.webview_windows() {
        if pet_window_index(&label).is_none() {
            continue;
        }
        let _ = pet.set_always_on_top(settings.pet.always_on_top);
        let _ = pet.set_ignore_cursor_events(settings.pet.click_through);
        let reposition = pet
            .outer_position()
            .ok()
            .zip(pet.outer_size().ok())
            .zip(pet.current_monitor().ok().flatten())
            .map(|((position, old_size), monitor)| {
                let scale_factor = monitor.scale_factor();
                // Add a small padding so the sprite is never clipped by the
                // window's non-client area at extreme scales.
                let new_width = ((192.0 * settings.pet.scale + 6.0) * scale_factor).round() as i32;
                let new_height = ((208.0 * settings.pet.scale + 6.0) * scale_factor).round() as i32;
                let work_area = monitor.work_area();
                motion::resize_around_bottom_center(
                    motion::Point {
                        x: position.x as f64,
                        y: position.y as f64,
                    },
                    old_size.width as i32,
                    old_size.height as i32,
                    new_width,
                    new_height,
                    motion::WorkArea {
                        left: work_area.position.x,
                        top: work_area.position.y,
                        right: work_area.position.x + work_area.size.width as i32,
                        bottom: work_area.position.y + work_area.size.height as i32,
                    },
                )
            });
        let _ = pet.set_size(tauri::LogicalSize::new(
            192.0 * settings.pet.scale + 6.0,
            208.0 * settings.pet.scale + 6.0,
        ));
        if let Some(position) = reposition {
            let _ = pet.set_position(tauri::PhysicalPosition::new(
                position.x.round() as i32,
                position.y.round() as i32,
            ));
        }
    }
    let _ = app.emit("settings://scale", settings.pet.scale);
}

fn set_click_through(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?;
    for (label, pet) in app.webview_windows() {
        if pet_window_index(&label).is_some() {
            pet.set_ignore_cursor_events(enabled)
                .map_err(|error| error.to_string())?;
        }
    }
    settings.pet.click_through = enabled;
    state
        .settings_store
        .save(&settings)
        .map_err(|error| error.to_string())
}

fn show_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn create_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "暂停 / 继续", true, None::<&str>)?;
    let recall = MenuItem::with_id(app, "recall", "召回当前屏幕", true, None::<&str>)?;
    let click_through =
        MenuItem::with_id(app, "click-through", "切换点击穿透", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 DeskMate", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &settings,
            &pause,
            &recall,
            &click_through,
            &separator,
            &quit,
        ],
    )?;
    let mut builder = TrayIconBuilder::new()
        .tooltip("DeskMate")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => show_settings(app),
            "pause" => {
                let state = app.state::<AppState>();
                let paused = !state.paused.fetch_xor(true, Ordering::Relaxed);
                for (label, pet) in app.webview_windows() {
                    if pet_window_index(&label).is_none() {
                        continue;
                    }
                    if paused {
                        let _ = pet.hide();
                    } else {
                        let _ = pet.show();
                    }
                }
            }
            "recall" => {
                let _ = runtime::recall_to_cursor_monitor(app);
            }
            "click-through" => {
                let enabled = app
                    .state::<AppState>()
                    .settings
                    .lock()
                    .ok()
                    .is_some_and(|settings| !settings.pet.click_through);
                let _ = set_click_through(app, enabled);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_settings(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn register_shortcuts(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{Builder, Code, Modifiers, ShortcutState};
    app.handle().plugin(
        Builder::new()
            .with_shortcuts(["ctrl+alt+m", "ctrl+alt+p"])
            .map_err(|error| std::io::Error::other(error.to_string()))?
            .with_handler(|app, shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                let modifiers = Modifiers::CONTROL | Modifiers::ALT;
                if shortcut.matches(modifiers, Code::KeyM) {
                    let _ = runtime::recall_to_cursor_monitor(app);
                }
                if shortcut.matches(modifiers, Code::KeyP) {
                    let enabled = app
                        .state::<AppState>()
                        .settings
                        .lock()
                        .ok()
                        .is_some_and(|settings| !settings.pet.click_through);
                    let _ = set_click_through(app, enabled);
                }
            })
            .build(),
    )?;
    Ok(())
}

fn start_online_refreshes(app: tauri::AppHandle) {
    let catalog_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            if refresh_catalog(&catalog_app).await.is_ok() {
                let _ = auto_update_selected_pets(&catalog_app).await;
            }
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(90)).await;
        loop {
            if updater_endpoint().is_some() {
                if let Err(error) = check_for_update(&app).await {
                    let _ = app.emit("update://error", error);
                }
            }
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

async fn refresh_catalog(app: &tauri::AppHandle) -> Result<PetCatalogV1, String> {
    let bytes = fetch_catalog_bytes(app).await?;
    let catalog: PetCatalogV1 =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let app_version = semver::Version::parse(APP_VERSION).map_err(|error| error.to_string())?;
    pets::validate_catalog(&catalog, &app_version)?;
    let state = app.state::<AppState>();
    SettingsStore::new(state.data_dir.join("catalog-v1.json"))
        .save_value(&serde_json::to_value(&catalog).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    *state.catalog.write().map_err(|_| "catalog lock poisoned")? = Some(catalog.clone());
    Ok(catalog)
}

async fn fetch_catalog_bytes(app: &tauri::AppHandle) -> Result<Vec<u8>, String> {
    let client = app.state::<AppState>().client.clone();
    if let Some(url) = catalog_url() {
        match fetch_limited(&client, url, MAX_CATALOG_BYTES, "catalog").await {
            Ok(bytes) => return Ok(bytes),
            // The Pages-hosted catalog is unreachable from some networks
            // (e.g. *.github.io is blocked in mainland China), so fall through
            // to the release-asset mirror instead of failing outright.
            Err(error) => eprintln!("catalog fetch from primary URL failed: {error}"),
        }
    }
    fetch_release_asset_bytes(
        app,
        repository_slug(),
        PETS_RELEASE_TAG,
        CATALOG_ASSET_NAME,
        MAX_CATALOG_BYTES,
        "catalog",
    )
    .await
}

async fn fetch_limited(
    client: &reqwest::Client,
    url: url::Url,
    max_bytes: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("{label} returned {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(format!("{label} is too large"));
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if bytes.len() + chunk.len() > max_bytes {
            return Err(format!("{label} is too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[derive(serde::Deserialize)]
struct GithubReleaseAsset {
    name: String,
    url: String,
}

#[derive(serde::Deserialize)]
struct GithubRelease {
    assets: Vec<GithubReleaseAsset>,
}

/// Resolve a GitHub Release asset to its API download URL. The API stays
/// reachable where github.com itself is blocked, and serves the same immutable
/// release bytes (integrity is still verified against the catalog SHA-256).
async fn resolve_release_asset_url(
    client: &reqwest::Client,
    repository: &str,
    tag: &str,
    asset_name: &str,
) -> Result<url::Url, String> {
    let release: GithubRelease = client
        .get(format!(
            "https://api.github.com/repos/{repository}/releases/tags/{tag}"
        ))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| format!("release {tag} has no asset named {asset_name}"))?;
    let url = url::Url::parse(&asset.url).map_err(|error| error.to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("api.github.com") {
        return Err("release asset API URL must be api.github.com HTTPS".into());
    }
    Ok(url)
}

async fn fetch_release_asset_bytes(
    app: &tauri::AppHandle,
    repository: &str,
    tag: &str,
    asset_name: &str,
    max_bytes: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let client = app.state::<AppState>().client.clone();
    let url = resolve_release_asset_url(&client, repository, tag, asset_name).await?;
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("{label} returned {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(format!("{label} is too large"));
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if bytes.len() + chunk.len() > max_bytes {
            return Err(format!("{label} is too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn repository_slug() -> &'static str {
    PROJECT_URL.trim_start_matches("https://github.com/")
}

/// Split an immutable github.com release-download URL into
/// (repository, tag, asset name) so the same asset can be fetched through the
/// GitHub API when github.com itself is unreachable.
fn github_release_download_parts(url: &url::Url) -> Option<(String, String, String)> {
    if url.scheme() != "https" || url.host_str() != Some("github.com") {
        return None;
    }
    let segments: Vec<&str> = url.path_segments()?.collect();
    if segments.len() >= 6 && segments[2] == "releases" && segments[3] == "download" {
        let repository = format!("{}/{}", segments[0], segments[1]);
        let tag = segments[4].to_string();
        let asset_name = segments.last()?.to_string();
        if !asset_name.is_empty() {
            return Some((repository, tag, asset_name));
        }
    }
    None
}

async fn install_entry(app: &tauri::AppHandle, entry: &PetCatalogEntryV1) -> Result<(), String> {
    let package_url = url::Url::parse(&entry.package_url).map_err(|error| error.to_string())?;
    if package_url.scheme() != "https"
        || package_url.host_str() != Some("github.com")
        || !package_url.path().contains("/releases/download/")
    {
        return Err("pet packages must be immutable GitHub Release HTTPS assets".into());
    }
    let state = app.state::<AppState>();
    // Serialize installs so a background auto-update and a user-triggered install
    // can't interleave writes to the same .part file or race the final rename.
    let _install_guard = state.install_lock.lock().await;
    let bytes = download_pet_package(app, &package_url, entry).await?;
    let downloads = state.data_dir.join("downloads");
    std::fs::create_dir_all(&downloads).map_err(|error| error.to_string())?;
    let package = downloads.join(format!("{}-{}.zip.part", entry.id, entry.version));
    std::fs::write(&package, &bytes).map_err(|error| error.to_string())?;
    let result = install_downloaded_package(app, entry, &package);
    let _ = std::fs::remove_file(&package);
    result
}

/// Download a pet package, falling back to the GitHub API mirror of the same
/// release asset when the direct github.com download fails (e.g. networks
/// where github.com is blocked). The SHA-256 check in
/// `install_downloaded_package` verifies the bytes either way.
async fn download_pet_package(
    app: &tauri::AppHandle,
    package_url: &url::Url,
    entry: &PetCatalogEntryV1,
) -> Result<Vec<u8>, String> {
    let client = app.state::<AppState>().client.clone();
    match stream_pet_package(app, &client, package_url.clone(), entry, false).await {
        Ok(bytes) => Ok(bytes),
        Err(direct_error) => {
            let Some((repository, tag, asset_name)) = github_release_download_parts(package_url)
            else {
                return Err(direct_error);
            };
            let api_url = resolve_release_asset_url(&client, &repository, &tag, &asset_name).await;
            match api_url {
                Ok(api_url) => stream_pet_package(app, &client, api_url, entry, true)
                    .await
                    .map_err(|api_error| {
                        format!("{direct_error}; API 备用下载也失败：{api_error}")
                    }),
                Err(api_error) => Err(format!("{direct_error}; API 备用下载也失败：{api_error}")),
            }
        }
    }
}

async fn stream_pet_package(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    url: url::Url,
    entry: &PetCatalogEntryV1,
    via_api: bool,
) -> Result<Vec<u8>, String> {
    let request = client.get(url);
    let request = if via_api {
        request.header(reqwest::header::ACCEPT, "application/octet-stream")
    } else {
        request
    };
    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("pet download returned {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length != entry.size_bytes || length > MAX_PET_PACKAGE_BYTES)
    {
        return Err("pet download size does not match the catalog".into());
    }
    let mut stream = response.bytes_stream();
    let total = entry.size_bytes;
    let mut downloaded: u64 = 0;
    let mut bytes = Vec::with_capacity(entry.size_bytes.min(MAX_PET_PACKAGE_BYTES) as usize);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if bytes.len() + chunk.len() > MAX_PET_PACKAGE_BYTES as usize {
            return Err("pet package is too large".into());
        }
        bytes.extend_from_slice(&chunk);
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        let _ = app.emit(
            "pet://install-progress",
            InstallProgressPayload {
                id: entry.id.clone(),
                version: entry.version.clone(),
                downloaded,
                total,
            },
        );
    }
    if bytes.len() as u64 != entry.size_bytes {
        return Err("pet download size does not match the catalog".into());
    }
    Ok(bytes)
}

fn install_downloaded_package(
    app: &tauri::AppHandle,
    entry: &PetCatalogEntryV1,
    package: &Path,
) -> Result<(), String> {
    if pets::sha256_file(package).map_err(|error| error.to_string())?
        != entry.sha256.to_ascii_lowercase()
    {
        return Err("pet SHA-256 mismatch".into());
    }
    pets::validate_package(package, MAX_PET_PACKAGE_BYTES).map_err(|error| error.to_string())?;
    let state = app.state::<AppState>();
    let pets_root = state.data_dir.join("pets");
    let id_root = pets_root.join(&entry.id);
    std::fs::create_dir_all(&id_root).map_err(|error| error.to_string())?;
    let destination = id_root.join(&entry.version);
    if destination.exists() {
        return Ok(());
    }
    let staging = id_root.join(format!(
        ".{}.staging-{}",
        entry.version,
        chrono::Utc::now().timestamp_millis()
    ));
    pets::extract_validated_package(package, &staging).map_err(|error| error.to_string())?;
    let (manifest, _) = pets::load_pet_directory(&staging)?;
    if manifest.id != entry.id {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("pet manifest id does not match the catalog".into());
    }
    std::fs::rename(&staging, &destination).map_err(|error| error.to_string())?;
    let _ = app.emit(
        "pet://installed",
        serde_json::json!({ "id": entry.id, "version": entry.version }),
    );
    Ok(())
}

/// Ensure one live window exists per selected pet: close surplus pet windows,
/// create missing ones (each with its own motion engine), apply window-level
/// settings, and push every window the pet it should render.
fn sync_pet_windows(app: &tauri::AppHandle) -> Result<(), String> {
    let settings = app
        .state::<AppState>()
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?
        .clone();
    let desired: Vec<String> = (0..settings.selected_pets.len())
        .map(pet_window_label)
        .collect();
    for (label, window) in app.webview_windows() {
        if pet_window_index(&label).is_some() && !desired.contains(&label) {
            let _ = window.close();
        }
    }
    for (index, label) in desired.iter().enumerate() {
        if app.get_webview_window(label).is_none() {
            create_pet_window(app, label, &settings, index)?;
        }
        runtime::ensure_motion_engine(app, label);
    }
    apply_window_settings(app, &settings);
    for (index, selected) in settings.selected_pets.iter().enumerate() {
        if let Ok(payload) = resolve_pet_payload(app, &selected.id, &selected.version) {
            let _ = app.emit_to(pet_window_label(index), "pet://changed", payload);
        }
    }
    Ok(())
}

fn create_pet_window(
    app: &tauri::AppHandle,
    label: &str,
    settings: &SettingsV1,
    index: usize,
) -> Result<tauri::WebviewWindow, String> {
    let width = 192.0 * settings.pet.scale + 6.0;
    let height = 208.0 * settings.pet.scale + 6.0;
    let window = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::App("index.html?view=pet".into()),
    )
    .title("DeskMate")
    .transparent(true)
    .decorations(false)
    .resizable(false)
    .shadow(false)
    .always_on_top(settings.pet.always_on_top)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .inner_size(width, height)
    .build()
    .map_err(|error| format!("创建桌宠窗口失败：{error}"))?;
    // Stagger new pets along the bottom of the cursor monitor so they don't
    // stack on top of each other.
    if let Some(area) = runtime::cursor_work_area() {
        let offset = index as f64 * (width + 48.0);
        let center = area.left as f64 + (area.right - area.left) as f64 / 2.0;
        let x = center + offset - width / 2.0;
        let y = area.bottom as f64 - height - 48.0;
        let _ = window.set_position(tauri::PhysicalPosition::new(
            x.round() as i32,
            y.round() as i32,
        ));
    }
    let _ = window.show();
    Ok(window)
}

fn custom_pets_root(app: &tauri::AppHandle) -> PathBuf {
    app.state::<AppState>()
        .custom_pets_dir
        .read()
        .expect("custom_pets_dir lock poisoned")
        .clone()
}

fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_pet_payload(
    app: &tauri::AppHandle,
    id: &str,
    version: &str,
) -> Result<PetChangedPayload, String> {
    if let Some(sprite_version_number) = bundled_pet_sprite_version(id, version) {
        return Ok(PetChangedPayload {
            id: id.into(),
            version: version.into(),
            sprite_version_number,
            spritesheet_path: None,
        });
    }
    let (spritesheet, sprite_version_number) = if version == "local" {
        let (manifest, spritesheet) = pets::find_local_pet(&custom_pets_root(app), id)?;
        (spritesheet, manifest.sprite_version_number)
    } else {
        pets::load_pet_directory(
            &app.state::<AppState>()
                .data_dir
                .join("pets")
                .join(id)
                .join(version),
        )
        .map(|(manifest, spritesheet)| (spritesheet, manifest.sprite_version_number))?
    };
    if !spritesheet.is_file() {
        return Err("pet version is not installed".into());
    }
    pet_asset_scope::authorize_selected_asset(&spritesheet, |path| {
        app.asset_protocol_scope().allow_file(path)
    })?;
    Ok(PetChangedPayload {
        id: id.into(),
        version: version.into(),
        sprite_version_number,
        spritesheet_path: Some(spritesheet),
    })
}

fn bundled_pet_sprite_version(id: &str, version: &str) -> Option<u8> {
    BUILT_IN_PETS
        .iter()
        .find(|(built_in_id, built_in_version, _)| {
            *built_in_id == id && *built_in_version == version
        })
        .map(|(_, _, sprite_version_number)| *sprite_version_number)
}

async fn auto_update_selected_pets(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let selected = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?
        .selected_pets
        .clone();
    let app_version = semver::Version::parse(APP_VERSION).map_err(|error| error.to_string())?;
    let catalog = state
        .catalog
        .read()
        .map_err(|_| "catalog lock poisoned")?
        .clone()
        .ok_or("catalog unavailable")?;
    let mut upgrades: Vec<(String, PetCatalogEntryV1)> = Vec::new();
    for pet in &selected {
        if pet.version == "local" {
            continue;
        }
        let Ok(current) = semver::Version::parse(&pet.version) else {
            continue;
        };
        let candidate = catalog
            .pets
            .iter()
            .filter(|entry| entry.id == pet.id)
            .filter_map(|entry| {
                let version = semver::Version::parse(&entry.version).ok()?;
                let minimum = semver::Version::parse(&entry.min_app_version).ok()?;
                (version > current && minimum <= app_version).then_some((version, entry))
            })
            .max_by(|left, right| left.0.cmp(&right.0));
        if let Some((_, entry)) = candidate {
            upgrades.push((pet.version.clone(), entry.clone()));
        }
    }
    if upgrades.is_empty() {
        return Ok(());
    }
    for (_, entry) in &upgrades {
        install_entry(app, entry).await?;
    }
    wait_until_pet_idle(app).await;
    // Apply the upgrades to pets that are still selected, then re-sync windows.
    let changed = {
        let mut settings = state
            .settings
            .lock()
            .map_err(|_| "settings lock poisoned")?;
        let mut changed = false;
        for (old_version, entry) in &upgrades {
            for pet in settings.selected_pets.iter_mut() {
                if pet.id == entry.id && &pet.version == old_version {
                    pet.version = entry.version.clone();
                    changed = true;
                }
            }
        }
        if changed {
            settings.selected_pet = settings.selected_pets[0].clone();
            state
                .settings_store
                .save(&settings)
                .map_err(|error| error.to_string())?;
        }
        changed
    };
    if changed {
        sync_pet_windows(app)?;
    }
    Ok(())
}

async fn wait_until_pet_idle(app: &tauri::AppHandle) {
    for _ in 0..1_200 {
        let state = app.state::<AppState>();
        if !any_window_flag(&state.moving)
            && !any_window_flag(&state.dragging)
            && !any_window_flag(&state.interacting)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn check_for_update(app: &tauri::AppHandle) -> Result<UpdateStatus, String> {
    let endpoint = updater_endpoint().ok_or("app updater is not configured for this build")?;
    let public_key =
        option_env!("DESKMATE_UPDATER_PUBLIC_KEY").ok_or("updater public key is missing")?;
    let updater = app
        .updater_builder()
        .pubkey(public_key)
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    let status = UpdateStatus {
        available: update.is_some(),
        version: update.as_ref().map(|item| item.version.clone()),
        notes: update.as_ref().and_then(|item| item.body.clone()),
    };
    if let Some(update) = update {
        let bytes = update
            .download(|_, _| {}, || {})
            .await
            .map_err(|error| error.to_string())?;
        *app.state::<AppState>()
            .ready_update
            .lock()
            .map_err(|_| "updater lock poisoned")? = Some(ReadyUpdate { update, bytes });
        let _ = app.emit("update://ready", &status);
    }
    Ok(status)
}

fn catalog_url() -> Option<url::Url> {
    option_env!("DESKMATE_CATALOG_URL")
        .and_then(|value| url::Url::parse(value).ok())
        .filter(|url| url.scheme() == "https")
}

fn updater_endpoint() -> Option<url::Url> {
    option_env!("DESKMATE_UPDATER_ENDPOINT")
        .and_then(|value| url::Url::parse(value).ok())
        .filter(|url| url.scheme() == "https")
}

fn load_cached_catalog(data_dir: &Path) -> Option<PetCatalogV1> {
    let bytes = std::fs::read(data_dir.join("catalog-v1.json")).ok()?;
    let catalog = serde_json::from_slice::<PetCatalogV1>(&bytes).ok()?;
    let app_version = semver::Version::parse(APP_VERSION).ok()?;
    pets::validate_catalog(&catalog, &app_version).ok()?;
    Some(catalog)
}
