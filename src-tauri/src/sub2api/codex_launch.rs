//! Launch the Codex desktop app against the signed-in gateway.
//!
//! Mirrors cockpit-tools' API-key Codex instances: a dedicated `CODEX_HOME`
//! holds `auth.json` (`auth_mode = "apikey"`) and a `config.toml` whose
//! top-level `openai_base_url` routes Codex's built-in `openai` provider to
//! the gateway. The built-in provider id is kept so existing sessions stay
//! visible; `[model_providers.openai].name` is set to the gateway website
//! name. A separate Electron user-data dir lets this instance run next
//! to the user's own Codex app; their `~/.codex` and app data are never
//! touched, and the API key lives only in the owner-only `auth.json`.

use std::fs;
use std::path::Path;

use serde_json::json;

use super::{AuthError, Result};

const CODEX_HOME_DIR: &str = "codex-gateway";
const CODEX_APP_DATA_DIR: &str = "codex-gateway-app-data";
/// Top-level keys we own; any other user setting in config.toml is preserved.
/// `cli_auth_credentials_store` is pinned to `file` so the desktop app reads the
/// API key from this profile's `auth.json` instead of the login keychain.
const MANAGED_TOP_LEVEL_KEYS: [&str; 3] = [
    "openai_base_url",
    "model_provider",
    "cli_auth_credentials_store",
];
const FORCED_LOGIN_METHOD_KEY: &str = "forced_login_method";
/// The Codex desktop app ships as `ChatGPT.app` (bundle `com.openai.codex`);
/// older builds were named `Codex.app`.
#[cfg(target_os = "macos")]
const MACOS_APP_CANDIDATES: [&str; 2] = ["ChatGPT.app", "Codex.app"];
#[cfg(target_os = "macos")]
const MACOS_BUNDLE_ID: &str = "com.openai.codex";

pub(super) enum LaunchOutcome {
    Started,
    AlreadyRunning,
}

/// App bundle file name when the Codex desktop app is installed.
pub(super) fn installed_app_name() -> Option<String> {
    platform::installed_app_name()
}

pub(super) fn launch(base_url: &str, api_key: &str, provider_name: &str) -> Result<LaunchOutcome> {
    let root = dirs::home_dir()
        .ok_or_else(|| AuthError::new("STORE_ERROR"))?
        .join(".myagents");
    let home = root.join(CODEX_HOME_DIR);
    let app_data = root.join(CODEX_APP_DATA_DIR);
    // Refresh credentials even when the instance is running: Codex re-reads
    // auth.json, so a rotated key takes effect without restarting it.
    write_profile(&home, base_url, api_key, provider_name)?;
    // History is best-effort: a failure must not block launching Codex.
    if let Some(user_home) = dirs::home_dir().map(|dir| dir.join(".codex")) {
        share_history(&home, &user_home);
    }
    platform::launch(&home, &app_data)
}

fn write_profile(home: &Path, base_url: &str, api_key: &str, provider_name: &str) -> Result<()> {
    let store = |_| AuthError::new("STORE_ERROR");
    fs::create_dir_all(home).map_err(store)?;
    let auth = json!({ "auth_mode": "apikey", "OPENAI_API_KEY": api_key });
    let bytes = serde_json::to_vec_pretty(&auth).map_err(|_| AuthError::new("STORE_ERROR"))?;
    write_private(&home.join("auth.json"), &bytes)?;
    let config_path = home.join("config.toml");
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    fs::write(
        &config_path,
        merge_config(&existing, base_url, provider_name),
    )
    .map_err(store)
}

/// History lives in the Codex home, so the dedicated profile starts empty.
/// Link its rollout stores to the user's `~/.codex` so the gateway instance
/// lists the same conversations. Only history is shared; auth and config stay
/// profile-local. Sessions already recorded in the profile are moved over.
///
/// Unix uses symlinks. Windows uses directory junctions and file hard links so
/// the same link works without Developer Mode, and later messages written by
/// either side stay in the user's Codex history.
pub(super) fn share_history(home: &Path, user_home: &Path) {
    if !user_home.is_dir() {
        return;
    }
    for (name, is_dir) in [
        ("sessions", true),
        ("archived_sessions", true),
        ("session_index.jsonl", false),
        ("history.jsonl", false),
    ] {
        let shared = user_home.join(name);
        let local = home.join(name);
        if is_reparse(&local) || same_history_file(&local, &shared) {
            continue;
        }
        if is_dir {
            if fs::create_dir_all(&shared).is_err() {
                continue;
            }
            if is_real_dir(&local) {
                merge_dir(&local, &shared);
                let _ = fs::remove_dir_all(&local);
            }
        } else if is_real_file(&local) {
            if !shared.exists() {
                let _ = fs::rename(&local, &shared);
            } else if let Ok(extra) = fs::read(&local) {
                // Append-only logs: fold profile-local lines into the shared one.
                use std::io::Write;
                let appended = fs::OpenOptions::new()
                    .append(true)
                    .open(&shared)
                    .and_then(|mut file| file.write_all(&extra));
                if appended.is_err() {
                    continue;
                }
                let _ = fs::remove_file(&local);
            }
        }
        if !shared.exists() || local.exists() {
            continue;
        }
        let _ = create_history_link(&shared, &local, is_dir);
    }
}

fn is_reparse(path: &Path) -> bool {
    #[cfg(unix)]
    {
        fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        junction::exists(path).ok() == Some(true)
            || fs::symlink_metadata(path).is_ok_and(|meta| {
                meta.file_type().is_symlink()
                    || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            })
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        false
    }
}

/// A Windows file hard link has no symlink bit. The second launch must see it
/// as the user's history file, not append the log onto itself.
fn same_history_file(local: &Path, shared: &Path) -> bool {
    #[cfg(windows)]
    {
        return windows_file_id(local)
            .zip(windows_file_id(shared))
            .is_some_and(|(local, shared)| local == shared);
    }
    #[cfg(not(windows))]
    {
        let _ = (local, shared);
        false
    }
}

/// `MetadataExt::file_index` is still unstable on the pinned toolchain.
/// The handle query is the stable way to tell a hard link from a second file.
#[cfg(windows)]
fn windows_file_id(path: &Path) -> Option<(u32, u32, u32)> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let file = fs::File::open(path).ok()?;
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
        return None;
    }
    Some((
        info.dwVolumeSerialNumber,
        info.nFileIndexHigh,
        info.nFileIndexLow,
    ))
}

fn is_real_dir(path: &Path) -> bool {
    !is_reparse(path) && fs::metadata(path).is_ok_and(|meta| meta.is_dir())
}

fn is_real_file(path: &Path) -> bool {
    !is_reparse(path) && fs::metadata(path).is_ok_and(|meta| meta.is_file())
}

fn create_history_link(shared: &Path, local: &Path, is_dir: bool) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        let _ = is_dir;
        std::os::unix::fs::symlink(shared, local)
    }
    #[cfg(windows)]
    {
        if is_dir {
            junction::create(shared, local)
        } else if fs::hard_link(shared, local).is_ok() {
            Ok(())
        } else {
            std::os::windows::fs::symlink_file(shared, local)
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (shared, local, is_dir);
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "history links are unavailable",
        ))
    }
}

/// Move entries from `from` into `to` without overwriting existing ones.
fn merge_dir(from: &Path, to: &Path) {
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let target = to.join(entry.file_name());
        let source = entry.path();
        if is_real_dir(&source) {
            if fs::create_dir_all(&target).is_ok() {
                merge_dir(&source, &target);
            }
        } else if !is_reparse(&source) && !target.exists() {
            let _ = fs::rename(&source, &target);
        }
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let store = |_| AuthError::new("STORE_ERROR");
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(store)?;
        file.write_all(bytes).map_err(store)?;
        // `mode` only applies on create; tighten a pre-existing file too.
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(store)
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes).map_err(|_| AuthError::new("STORE_ERROR"))
    }
}

/// Prefer the gateway website name; fall back to the base URL host.
pub(super) fn provider_display_name(site_name: &str, base_url: &str) -> String {
    let from_site = sanitize_provider_name(site_name);
    if !from_site.is_empty() {
        return from_site;
    }
    let host = url::Url::parse(base_url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_owned))
        .unwrap_or_default();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let from_host = sanitize_provider_name(host);
    if !from_host.is_empty() {
        from_host
    } else {
        "LSAGENT".into()
    }
}

fn sanitize_provider_name(name: &str) -> String {
    let collapsed = name.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(80).collect()
}

fn quote_toml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

/// Keep the built-in `openai` provider id (session history is keyed to it)
/// and upsert its display name / base URL without dropping other tables.
fn upsert_openai_provider(tail: &mut Vec<String>, name: &str, base_url: &str) {
    let header = "[model_providers.openai]";
    let name_line = format!("name = {}", quote_toml_string(name));
    let url_line = format!("base_url = {}", quote_toml_string(base_url));
    let mut i = 0;
    while i < tail.len() {
        if tail[i].trim() == header {
            i += 1;
            let table_start = i;
            while i < tail.len() && !tail[i].trim_start().starts_with('[') {
                i += 1;
            }
            let table_end = i;
            let mut saw_name = false;
            let mut saw_url = false;
            for line in tail.iter_mut().take(table_end).skip(table_start) {
                let key = line.trim_start().split('=').next().unwrap_or("").trim();
                if key == "name" {
                    *line = name_line.clone();
                    saw_name = true;
                } else if key == "base_url" {
                    *line = url_line.clone();
                    saw_url = true;
                }
            }
            let mut insert_at = table_end;
            if !saw_url {
                tail.insert(insert_at, url_line);
                insert_at += 1;
            }
            if !saw_name {
                tail.insert(insert_at, name_line);
            }
            return;
        }
        i += 1;
    }
    if tail
        .last()
        .map(|line| !line.trim().is_empty())
        .unwrap_or(false)
    {
        tail.push(String::new());
    }
    tail.push(header.into());
    tail.push(name_line);
    tail.push(url_line);
    tail.push("wire_api = \"responses\"".into());
    tail.push("requires_openai_auth = true".into());
}

/// Replace our top-level keys (before the first `[table]`) and keep the rest.
/// A locked `forced_login_method` that is not `api` would make Codex treat the
/// API-key profile as signed out, so that one conflict is rewritten to `api`.
/// An unset login method is left unset; Codex then follows `auth.json`.
pub(super) fn merge_config(existing: &str, base_url: &str, provider_name: &str) -> String {
    let mut head = Vec::new();
    let mut tail = Vec::new();
    let mut in_tables = false;
    let mut locked_login_method = false;
    for line in existing.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('[') {
            in_tables = true;
        }
        if in_tables {
            tail.push(line.to_string());
            continue;
        }
        let key = trimmed.split('=').next().unwrap_or("").trim();
        if key == FORCED_LOGIN_METHOD_KEY {
            let value = trimmed
                .split_once('=')
                .map(|(_, value)| value.trim().trim_matches('"').to_ascii_lowercase())
                .unwrap_or_default();
            if value == "api" {
                head.push(line.to_string());
            } else {
                locked_login_method = true;
            }
            continue;
        }
        if !MANAGED_TOP_LEVEL_KEYS.contains(&key) {
            head.push(line.to_string());
        }
    }
    let quoted = quote_toml_string(base_url);
    let mut out = format!("openai_base_url = {quoted}\ncli_auth_credentials_store = \"file\"\n");
    if locked_login_method {
        out.push_str("forced_login_method = \"api\"\n");
    }
    upsert_openai_provider(&mut tail, provider_name, base_url);
    for line in head.into_iter().chain(tail) {
        out.push_str(&line);
        out.push('\n');
    }
    out
}

/// `open` arguments that start a separate Codex instance on our profile.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn open_args(app: &Path, home: &Path, app_data: &Path) -> Vec<String> {
    let app_data = app_data.to_string_lossy();
    vec![
        "-n".into(),
        "--env".into(),
        format!("CODEX_HOME={}", home.to_string_lossy()),
        "--env".into(),
        format!("CODEX_ELECTRON_USER_DATA_PATH={app_data}"),
        "-a".into(),
        app.to_string_lossy().into_owned(),
        "--args".into(),
        format!("--user-data-dir={app_data}"),
    ]
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::PathBuf;

    use super::*;
    use crate::{process_cmd, ulog_info, ulog_warn};

    pub(super) fn installed_app_name() -> Option<String> {
        find_app().and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
    }

    pub(super) fn launch(home: &Path, app_data: &Path) -> Result<LaunchOutcome> {
        let app = find_app().ok_or_else(|| AuthError::new("CODEX_APP_NOT_FOUND"))?;
        if instance_running(app_data) {
            ulog_info!("[sub2api] gateway Codex app already running");
            return Ok(LaunchOutcome::AlreadyRunning);
        }
        fs::create_dir_all(app_data).map_err(|_| AuthError::new("STORE_ERROR"))?;
        let status = process_cmd::new("open")
            .args(open_args(&app, home, app_data))
            .status();
        match status {
            Ok(status) if status.success() => {
                ulog_info!("[sub2api] launched gateway Codex app");
                Ok(LaunchOutcome::Started)
            }
            other => {
                ulog_warn!(
                    "[sub2api] failed to launch Codex app: {:?}",
                    other.map(|s| s.code())
                );
                Err(AuthError::new("LAUNCH_FAILED"))
            }
        }
    }

    fn find_app() -> Option<PathBuf> {
        let mut roots = vec![PathBuf::from("/Applications")];
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Applications"));
        }
        roots
            .iter()
            .flat_map(|root| MACOS_APP_CANDIDATES.iter().map(move |name| root.join(name)))
            .find(|path| path.join("Contents/Info.plist").is_file())
            .or_else(find_app_by_bundle_id)
    }

    /// Fall back to LaunchServices for installs outside the usual folders.
    fn find_app_by_bundle_id() -> Option<PathBuf> {
        let output = process_cmd::new("mdfind")
            .arg(format!("kMDItemCFBundleIdentifier == '{MACOS_BUNDLE_ID}'"))
            .output()
            .ok()?;
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(PathBuf::from)
            .find(|path| path.extension().is_some_and(|ext| ext == "app"))
    }

    /// The gateway instance is the one Electron started with our user-data dir.
    fn instance_running(app_data: &Path) -> bool {
        let marker = format!("--user-data-dir={}", app_data.to_string_lossy());
        process_cmd::new("ps")
            .args(["-axww", "-o", "command="])
            .output()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .any(|line| line.contains(&marker) && !line.contains("--type="))
            })
            .unwrap_or(false)
    }
}

#[cfg(any(test, target_os = "windows"))]
#[path = "codex_launch_windows.rs"]
mod windows_codex;

#[cfg(target_os = "windows")]
mod platform {
    use std::path::Path;

    use super::{windows_codex, Result};

    pub(super) fn installed_app_name() -> Option<String> {
        windows_codex::installed_app_name()
    }

    pub(super) fn launch(home: &Path, app_data: &Path) -> Result<super::LaunchOutcome> {
        windows_codex::launch(home, app_data)
    }
}

#[cfg(target_os = "windows")]
pub(super) fn try_package_launch() -> Option<i32> {
    windows_codex::try_package_launch()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use std::path::Path;

    use super::{AuthError, LaunchOutcome, Result};

    pub(super) fn installed_app_name() -> Option<String> {
        None
    }

    pub(super) fn launch(_home: &Path, _app_data: &Path) -> Result<LaunchOutcome> {
        Err(AuthError::new("CODEX_APP_UNSUPPORTED"))
    }
}
