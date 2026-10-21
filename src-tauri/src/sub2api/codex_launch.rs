//! Launch the Codex desktop app against the signed-in gateway.
//!
//! Mirrors cockpit-tools' API-key Codex instances: a dedicated `CODEX_HOME`
//! holds `auth.json` (`auth_mode = "apikey"`) and a `config.toml` whose
//! top-level `openai_base_url` routes Codex's built-in `openai` provider to
//! the gateway. A separate Electron user-data dir lets this instance run next
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

pub(super) fn launch(base_url: &str, api_key: &str) -> Result<LaunchOutcome> {
    let root = dirs::home_dir()
        .ok_or_else(|| AuthError::new("STORE_ERROR"))?
        .join(".myagents");
    let home = root.join(CODEX_HOME_DIR);
    let app_data = root.join(CODEX_APP_DATA_DIR);
    // Refresh credentials even when the instance is running: Codex re-reads
    // auth.json, so a rotated key takes effect without restarting it.
    write_profile(&home, base_url, api_key)?;
    platform::launch(&home, &app_data)
}

fn write_profile(home: &Path, base_url: &str, api_key: &str) -> Result<()> {
    let store = |_| AuthError::new("STORE_ERROR");
    fs::create_dir_all(home).map_err(store)?;
    let auth = json!({ "auth_mode": "apikey", "OPENAI_API_KEY": api_key });
    let bytes = serde_json::to_vec_pretty(&auth).map_err(|_| AuthError::new("STORE_ERROR"))?;
    write_private(&home.join("auth.json"), &bytes)?;
    let config_path = home.join("config.toml");
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    fs::write(&config_path, merge_config(&existing, base_url)).map_err(store)
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

/// Replace our top-level keys (before the first `[table]`) and keep the rest.
/// A locked `forced_login_method` that is not `api` would make Codex treat the
/// API-key profile as signed out, so that one conflict is rewritten to `api`.
/// An unset login method is left unset; Codex then follows `auth.json`.
pub(super) fn merge_config(existing: &str, base_url: &str) -> String {
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
            tail.push(line);
            continue;
        }
        let key = trimmed.split('=').next().unwrap_or("").trim();
        if key == FORCED_LOGIN_METHOD_KEY {
            let value = trimmed
                .split_once('=')
                .map(|(_, value)| value.trim().trim_matches('"').to_ascii_lowercase())
                .unwrap_or_default();
            if value == "api" {
                head.push(line);
            } else {
                locked_login_method = true;
            }
            continue;
        }
        if !MANAGED_TOP_LEVEL_KEYS.contains(&key) {
            head.push(line);
        }
    }
    let quoted = serde_json::to_string(base_url).unwrap_or_else(|_| "\"\"".into());
    let mut out = format!("openai_base_url = {quoted}\ncli_auth_credentials_store = \"file\"\n");
    if locked_login_method {
        out.push_str("forced_login_method = \"api\"\n");
    }
    for line in head.into_iter().chain(tail) {
        out.push_str(line);
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

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;

    pub(super) fn installed_app_name() -> Option<String> {
        None
    }

    pub(super) fn launch(_home: &Path, _app_data: &Path) -> Result<LaunchOutcome> {
        // Windows ships Codex as a Store package that needs AppUserModelId
        // activation; not wired yet.
        Err(AuthError::new("CODEX_APP_UNSUPPORTED"))
    }
}
