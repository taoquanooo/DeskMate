mod motion;
mod pets;
mod reminders;
mod runtime;
mod settings;

use futures_util::StreamExt;
use pets::{PetCatalogEntryV1, PetCatalogV1};
use serde::Serialize;
use settings::{SettingsStore, SettingsV1};
use std::{
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

pub struct AppState {
    settings: Mutex<SettingsV1>,
    settings_store: SettingsStore,
    catalog: RwLock<Option<PetCatalogV1>>,
    data_dir: PathBuf,
    client: reqwest::Client,
    paused: AtomicBool,
    fullscreen: AtomicBool,
    dragging: AtomicBool,
    interacting: AtomicBool,
    moving: AtomicBool,
    ready_update: Mutex<Option<ReadyUpdate>>,
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
fn pet_select(app: tauri::AppHandle, id: String, version: String) -> Result<(), String> {
    select_pet(&app, &id, &version)
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
            let catalog = load_cached_catalog(&data_dir);
            let reminder_runtime = Arc::new(reminders::ReminderRuntime::default());
            reminder_runtime.initialize(&settings.reminders);
            app.manage(AppState {
                settings: Mutex::new(settings.clone()),
                settings_store,
                catalog: RwLock::new(catalog),
                data_dir,
                client: reqwest::Client::builder()
                    .user_agent(format!("DeskMate/{APP_VERSION}"))
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(45))
                    .redirect(reqwest::redirect::Policy::limited(5))
                    .build()?,
                paused: AtomicBool::new(false),
                fullscreen: AtomicBool::new(false),
                dragging: AtomicBool::new(false),
                interacting: AtomicBool::new(false),
                moving: AtomicBool::new(false),
                ready_update: Mutex::new(None),
            });

            let drag_app = app.handle().clone();
            app.listen("runtime://dragging", move |event| {
                if let Ok(dragging) = serde_json::from_str::<bool>(event.payload()) {
                    drag_app
                        .state::<AppState>()
                        .dragging
                        .store(dragging, Ordering::Relaxed);
                }
            });
            let interaction_app = app.handle().clone();
            app.listen("runtime://interaction", move |event| {
                if let Ok(interacting) = serde_json::from_str::<bool>(event.payload()) {
                    interaction_app
                        .state::<AppState>()
                        .interacting
                        .store(interacting, Ordering::Relaxed);
                }
            });

            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))?;
            register_shortcuts(app)?;
            create_tray(app)?;
            apply_window_settings(app.handle(), &settings);
            if settings.onboarding_complete {
                if let Some(settings_window) = app.get_webview_window("settings") {
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
            pet_select,
            pet_recall,
            window_set_click_through,
            updater_check,
            updater_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskMate");
}

fn apply_window_settings(app: &tauri::AppHandle, settings: &SettingsV1) {
    let Some(pet) = app.get_webview_window("pet") else {
        return;
    };
    let _ = pet.set_always_on_top(settings.pet.always_on_top);
    let _ = pet.set_ignore_cursor_events(settings.pet.click_through);
    let _ = pet.set_size(tauri::LogicalSize::new(
        192.0 * settings.pet.scale,
        208.0 * settings.pet.scale,
    ));
}

fn set_click_through(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?;
    app.get_webview_window("pet")
        .ok_or("pet window missing")?
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())?;
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
                if let Some(pet) = app.get_webview_window("pet") {
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
                let _ = auto_update_selected_pet(&catalog_app).await;
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
    let url = catalog_url().ok_or("online catalog is not configured for this build")?;
    let state = app.state::<AppState>();
    let response = state
        .client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("catalog returned {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CATALOG_BYTES as u64)
    {
        return Err("catalog is too large".into());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err("catalog is too large".into());
    }
    let catalog: PetCatalogV1 =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let app_version = semver::Version::parse(APP_VERSION).map_err(|error| error.to_string())?;
    pets::validate_catalog(&catalog, &app_version)?;
    SettingsStore::new(state.data_dir.join("catalog-v1.json"))
        .save_value(&serde_json::to_value(&catalog).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    *state.catalog.write().map_err(|_| "catalog lock poisoned")? = Some(catalog.clone());
    Ok(catalog)
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
    let response = state
        .client
        .get(package_url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
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
    let mut bytes = Vec::with_capacity(entry.size_bytes.min(MAX_PET_PACKAGE_BYTES) as usize);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if bytes.len() + chunk.len() > MAX_PET_PACKAGE_BYTES as usize {
            return Err("pet package is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() as u64 != entry.size_bytes {
        return Err("pet download size does not match the catalog".into());
    }
    let downloads = state.data_dir.join("downloads");
    std::fs::create_dir_all(&downloads).map_err(|error| error.to_string())?;
    let package = downloads.join(format!("{}-{}.zip.part", entry.id, entry.version));
    std::fs::write(&package, &bytes).map_err(|error| error.to_string())?;
    let result = install_downloaded_package(app, entry, &package);
    let _ = std::fs::remove_file(&package);
    result
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
    let manifest: pets::PetManifestV2 = serde_json::from_slice(
        &std::fs::read(staging.join("pet.json")).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
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

fn select_pet(app: &tauri::AppHandle, id: &str, version: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let built_in = id == "yanghao" && version == "1.0.0";
    let spritesheet = state
        .data_dir
        .join("pets")
        .join(id)
        .join(version)
        .join("spritesheet.webp");
    if !built_in && !spritesheet.is_file() {
        return Err("pet version is not installed".into());
    }
    let mut settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?;
    settings.selected_pet.id = id.into();
    settings.selected_pet.version = version.into();
    state
        .settings_store
        .save(&settings)
        .map_err(|error| error.to_string())?;
    let payload = if built_in {
        serde_json::json!({ "id": id, "version": version, "spritesheetPath": null })
    } else {
        serde_json::json!({ "id": id, "version": version, "spritesheetPath": spritesheet })
    };
    app.emit("pet://changed", payload)
        .map_err(|error| error.to_string())
}

async fn auto_update_selected_pet(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let selected = state
        .settings
        .lock()
        .map_err(|_| "settings lock poisoned")?
        .selected_pet
        .clone();
    let current = semver::Version::parse(&selected.version).map_err(|error| error.to_string())?;
    let app_version = semver::Version::parse(APP_VERSION).map_err(|error| error.to_string())?;
    let catalog = state
        .catalog
        .read()
        .map_err(|_| "catalog lock poisoned")?
        .clone()
        .ok_or("catalog unavailable")?;
    let candidate = catalog
        .pets
        .into_iter()
        .filter(|entry| entry.id == selected.id)
        .filter_map(|entry| {
            let version = semver::Version::parse(&entry.version).ok()?;
            let minimum = semver::Version::parse(&entry.min_app_version).ok()?;
            (version > current && minimum <= app_version).then_some((version, entry))
        })
        .max_by(|left, right| left.0.cmp(&right.0));
    let Some((_, entry)) = candidate else {
        return Ok(());
    };
    install_entry(app, &entry).await?;
    wait_until_pet_idle(app).await;
    select_pet(app, &entry.id, &entry.version)
}

async fn wait_until_pet_idle(app: &tauri::AppHandle) {
    for _ in 0..1_200 {
        let state = app.state::<AppState>();
        if !state.moving.load(Ordering::Relaxed)
            && !state.dragging.load(Ordering::Relaxed)
            && !state.interacting.load(Ordering::Relaxed)
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
