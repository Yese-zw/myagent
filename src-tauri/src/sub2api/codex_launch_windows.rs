//! Windows Codex desktop detection and launch.
//!
//! The desktop app is usually the Microsoft Store package `OpenAI.Codex`
//! (`app\ChatGPT.exe`). Store binaries have to be activated with their package
//! identity, so this follows the same `Invoke-CommandInDesktopPackage` path as
//! cockpit-tools: a short-lived helper inside the package starts `ChatGPT.exe`
//! with the gateway `CODEX_HOME`. Unpackaged installs are started directly.
//! History itself is linked in `share_history` before either launch.

use std::path::Path;
#[cfg(target_os = "windows")]
use std::path::PathBuf;

use serde::Deserialize;
#[cfg(target_os = "windows")]
use serde::Serialize;

const HELPER_ARG: &str = "--myagents-codex-package-launch";
const STORE_PACKAGES: [&str; 2] = ["OpenAI.Codex", "OpenAI.ChatGPT"];

#[derive(Debug, Clone, PartialEq, Eq)]
struct InstalledApp {
    kind: AppKind,
    /// Dialog label, such as `ChatGPT` or `Codex`.
    name: String,
    executable: String,
    family_name: String,
    app_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AppKind {
    Store,
    Direct,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeApp {
    kind: String,
    executable: String,
    #[serde(default)]
    family_name: String,
    #[serde(default)]
    app_id: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Serialize, Deserialize)]
struct LaunchRequest {
    family_name: String,
    app_id: String,
    executable: String,
    user_data_dir: String,
    codex_home: String,
    result_path: String,
    nonce: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum LaunchReply {
    Spawned,
    EntryStale,
    Failed { message: String },
}

#[cfg(target_os = "windows")]
#[derive(Debug, Serialize, Deserialize)]
struct Receipt {
    nonce: String,
    reply: LaunchReply,
}

#[cfg(target_os = "windows")]
pub(super) fn installed_app_name() -> Option<String> {
    detect().map(|app| app.name)
}

#[cfg(target_os = "windows")]
pub(super) fn launch(home: &Path, app_data: &Path) -> super::Result<super::LaunchOutcome> {
    let app = detect().ok_or_else(|| super::AuthError::new("CODEX_APP_NOT_FOUND"))?;
    if instance_running(app_data) {
        crate::ulog_info!("[sub2api] gateway Codex app already running");
        return Ok(super::LaunchOutcome::AlreadyRunning);
    }
    std::fs::create_dir_all(app_data).map_err(|_| super::AuthError::new("STORE_ERROR"))?;
    match app.kind {
        AppKind::Direct => spawn_direct(&app, home, app_data),
        AppKind::Store => spawn_store(&app, home, app_data),
    }
}

/// Called before Tauri starts. A malformed helper invocation exits instead of
/// opening another window.
#[cfg(target_os = "windows")]
pub(super) fn try_package_launch() -> Option<i32> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if !args.iter().any(|arg| arg == HELPER_ARG) {
        return None;
    }
    if args.len() != 2 || args[0] != HELPER_ARG {
        return Some(2);
    }
    let result = (|| {
        use base64::{engine::general_purpose, Engine};
        let encoded = args[1].to_str().ok_or(())?;
        if encoded.len() > 30000 {
            return Err(());
        }
        let bytes = general_purpose::STANDARD.decode(encoded).map_err(|_| ())?;
        let request: LaunchRequest = serde_json::from_slice(&bytes).map_err(|_| ())?;
        if request.nonce.is_empty() || !Path::new(&request.result_path).is_absolute() {
            return Err(());
        }
        write_receipt(&request, helper_launch(&request)).map_err(|_| ())
    })();
    Some(if result.is_ok() { 0 } else { 2 })
}

#[cfg(target_os = "windows")]
fn detect() -> Option<InstalledApp> {
    let output = powershell(DETECTION_SCRIPT).ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if output.status.code() == Some(3) || stdout.trim().is_empty() {
        return None;
    }
    if !output.status.success() {
        crate::ulog_warn!(
            "[sub2api] Codex desktop probe failed: {}",
            stderr_tail(&output.stderr)
        );
        return None;
    }
    accept_probe(stdout.trim().trim_start_matches('\u{feff}'))
}

#[cfg(target_os = "windows")]
fn instance_running(app_data: &Path) -> bool {
    let Some(marker) = ps_quote(&app_data.to_string_lossy()) else {
        return false;
    };
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
$marker = {marker}
$hit = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {{
  $_.CommandLine -and $_.CommandLine.Contains($marker) -and $_.CommandLine -notlike '*--type=*'
}} | Select-Object -First 1
if ($hit) {{ 'running' }} else {{ 'idle' }}
"#
    );
    powershell(&script)
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).contains("running"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn spawn_direct(app: &InstalledApp, home: &Path, app_data: &Path) -> super::Result<super::LaunchOutcome> {
    use std::process::Stdio;
    crate::process_cmd::new(&app.executable)
        .arg(format!("--user-data-dir={}", app_data.display()))
        .env("CODEX_HOME", home)
        .env("CODEX_ELECTRON_USER_DATA_PATH", app_data)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            crate::ulog_warn!("[sub2api] failed to launch Codex app: {error}");
            super::AuthError::new("LAUNCH_FAILED")
        })?;
    crate::ulog_info!("[sub2api] launched gateway Codex app");
    Ok(super::LaunchOutcome::Started)
}

#[cfg(target_os = "windows")]
fn spawn_store(app: &InstalledApp, home: &Path, app_data: &Path) -> super::Result<super::LaunchOutcome> {
    match activate_store(app, home, app_data) {
        Ok(()) => {
            crate::ulog_info!("[sub2api] launched gateway Codex app");
            Ok(super::LaunchOutcome::Started)
        }
        // Only retry when registration changed before the client was created.
        Err(error) if error.contains("CODEX_PACKAGE_REGISTRATION_CHANGED") => {
            let Some(fresh) = detect().filter(|found| found.kind == AppKind::Store) else {
                return Err(super::AuthError::new("LAUNCH_FAILED"));
            };
            activate_store(&fresh, home, app_data).map_err(|error| {
                crate::ulog_warn!("[sub2api] failed to launch Codex app: {error}");
                super::AuthError::new("LAUNCH_FAILED")
            })?;
            crate::ulog_info!("[sub2api] launched gateway Codex app");
            Ok(super::LaunchOutcome::Started)
        }
        Err(error) => {
            crate::ulog_warn!("[sub2api] failed to launch Codex app: {error}");
            Err(super::AuthError::new("LAUNCH_FAILED"))
        }
    }
}

#[cfg(target_os = "windows")]
fn activate_store(app: &InstalledApp, home: &Path, app_data: &Path) -> Result<(), String> {
    let helper = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = std::env::temp_dir().join(format!(
        "myagents-codex-launch-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let result_path = directory.join("result.json");
    let request = LaunchRequest {
        family_name: app.family_name.clone(),
        app_id: app.app_id.clone(),
        executable: app.executable.clone(),
        user_data_dir: app_data.to_string_lossy().into_owned(),
        codex_home: home.to_string_lossy().into_owned(),
        result_path: result_path.to_string_lossy().into_owned(),
        nonce: uuid::Uuid::new_v4().to_string(),
    };
    let payload = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    use base64::{engine::general_purpose, Engine};
    let encoded = general_purpose::STANDARD.encode(payload);
    if encoded.len() > 30000 {
        let _ = std::fs::remove_dir_all(&directory);
        return Err("Codex launch payload is too large".into());
    }
    let Some(script) = activation_script(
        &request.family_name,
        &request.app_id,
        &helper.to_string_lossy(),
        &encoded,
    ) else {
        let _ = std::fs::remove_dir_all(&directory);
        return Err("Codex package identity is not safe to activate".into());
    };
    let output = powershell(&script);
    let reply = wait_receipt(&result_path, &request.nonce);
    let _ = std::fs::remove_dir_all(&directory);
    match reply {
        Some(LaunchReply::Spawned) => Ok(()),
        Some(LaunchReply::EntryStale) => Err("CODEX_PACKAGE_REGISTRATION_CHANGED".into()),
        Some(LaunchReply::Failed { message }) => Err(message),
        None => Err(match output {
            Ok(output) if String::from_utf8_lossy(&output.stdout).contains("CODEX_PACKAGE_REGISTRATION_CHANGED") => {
                "CODEX_PACKAGE_REGISTRATION_CHANGED".into()
            }
            Ok(output) => format!(
                "Codex package activation failed: {}",
                stderr_tail(&output.stderr)
            ),
            Err(error) => format!("Codex package activation failed: {error}"),
        }),
    }
}

#[cfg(target_os = "windows")]
fn wait_receipt(path: &Path, nonce: &str) -> Option<LaunchReply> {
    let started = std::time::Instant::now();
    while started.elapsed() < std::time::Duration::from_secs(8) {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(receipt) = serde_json::from_slice::<Receipt>(&bytes) {
                if receipt.nonce == nonce {
                    return Some(receipt.reply);
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    None
}

fn activation_script(family: &str, app_id: &str, helper: &str, payload: &str) -> Option<String> {
    if !valid_family(family) || !valid_app_id(app_id) || payload.contains('\'') {
        return None;
    }
    let family = ps_quote(family)?;
    let app_id = ps_quote(app_id)?;
    let helper = ps_quote(helper)?;
    let args = ps_quote(&format!("{HELPER_ARG} {payload}"))?;
    Some(format!(
        r#"$ErrorActionPreference = 'Stop'
try {{
  Invoke-CommandInDesktopPackage -PackageFamilyName {family} -AppId {app_id} -PreventBreakaway -Command {helper} -Args {args}
}} catch {{
  $exception = $_.Exception
  while ($exception) {{
    if ($exception.HResult -in @(-2147023728, -2147024894, -2147024893)) {{
      Write-Output 'CODEX_PACKAGE_REGISTRATION_CHANGED'
      exit 1
    }}
    $exception = $exception.InnerException
  }}
  [Console]::Error.WriteLine('Codex package activation failed')
  exit 1
}}
"#
    ))
}

#[cfg(target_os = "windows")]
fn helper_launch(request: &LaunchRequest) -> LaunchReply {
    let context = match current_package_context() {
        Ok(context) => context,
        Err(message) => return LaunchReply::Failed { message },
    };
    let (family, root) = context;
    let manifest = match std::fs::read_to_string(root.join("AppxManifest.xml")) {
        Ok(text) if text.len() <= 1024 * 1024 => text,
        Ok(_) => {
            return LaunchReply::Failed {
                message: "Package manifest is too large".into(),
            }
        }
        Err(error) => {
            return LaunchReply::Failed {
                message: format!("Package manifest read failed: {error}"),
            }
        }
    };
    let matched = manifest_gui_app_id(&root, Path::new(&request.executable), &manifest);
    if !family.eq_ignore_ascii_case(&request.family_name)
        || matched.as_deref() != Some(request.app_id.as_str())
        || !Path::new(&request.executable).is_file()
    {
        return LaunchReply::EntryStale;
    }
    match helper_command(request).spawn() {
        Ok(_child) => LaunchReply::Spawned,
        Err(error) if matches!(error.raw_os_error(), Some(2 | 3)) => LaunchReply::EntryStale,
        Err(error) => LaunchReply::Failed {
            message: format!("Client process creation failed: {error}"),
        },
    }
}

#[cfg(target_os = "windows")]
fn helper_command(request: &LaunchRequest) -> std::process::Command {
    use std::process::Stdio;
    let mut command = crate::process_cmd::new(&request.executable);
    command
        .arg(format!("--user-data-dir={}", request.user_data_dir))
        .env("CODEX_HOME", &request.codex_home)
        .env("CODEX_ELECTRON_USER_DATA_PATH", &request.user_data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(target_os = "windows")]
fn current_package_context() -> Result<(String, PathBuf), String> {
    let family = current_package_string(true)?;
    let root = PathBuf::from(current_package_string(false)?);
    Ok((family, root))
}

#[cfg(target_os = "windows")]
fn current_package_string(family: bool) -> Result<String, String> {
    use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS};
    use windows_sys::Win32::Storage::Packaging::Appx::{
        GetCurrentPackageFamilyName, GetCurrentPackagePath,
    };
    unsafe {
        let mut length = 0u32;
        let status = if family {
            GetCurrentPackageFamilyName(&mut length, std::ptr::null_mut())
        } else {
            GetCurrentPackagePath(&mut length, std::ptr::null_mut())
        };
        if status != ERROR_INSUFFICIENT_BUFFER || length == 0 || length > 32768 {
            return Err(format!("Package context query failed: win32={status}"));
        }
        let mut buffer = vec![0u16; length as usize];
        let status = if family {
            GetCurrentPackageFamilyName(&mut length, buffer.as_mut_ptr())
        } else {
            GetCurrentPackagePath(&mut length, buffer.as_mut_ptr())
        };
        if status != ERROR_SUCCESS {
            return Err(format!("Package context query failed: win32={status}"));
        }
        let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
        Ok(String::from_utf16_lossy(&buffer[..end]))
    }
}

#[cfg(target_os = "windows")]
fn write_receipt(request: &LaunchRequest, reply: LaunchReply) -> std::io::Result<()> {
    let path = Path::new(&request.result_path);
    let bytes = serde_json::to_vec(&Receipt {
        nonce: request.nonce.clone(),
        reply,
    })
    .map_err(|error| std::io::Error::other(error.to_string()))?;
    let pending = path.with_extension("pending");
    std::fs::write(&pending, bytes)?;
    std::fs::rename(pending, path)
}

#[cfg(target_os = "windows")]
fn powershell(script: &str) -> std::io::Result<std::process::Output> {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = crate::process_cmd::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("powershell stdin unavailable"))?
        .write_all(script.as_bytes())?;
    child.wait_with_output()
}

#[cfg(target_os = "windows")]
fn stderr_tail(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .chars()
        .filter(|ch| *ch != '\0')
        .take(400)
        .collect()
}

fn ps_quote(value: &str) -> Option<String> {
    if value.chars().any(|ch| ch == '\n' || ch == '\r' || ch == '\0') {
        return None;
    }
    Some(format!("'{}'", value.replace('\'', "''")))
}

fn accept_probe(text: &str) -> Option<InstalledApp> {
    let probe: ProbeApp = serde_json::from_str(text).ok()?;
    let executable = probe.executable.trim();
    if executable.is_empty() {
        return None;
    }
    let name = match normal_win(executable)
        .rsplit('\\')
        .next()
        .unwrap_or("")
    {
        "chatgpt.exe" => "ChatGPT",
        "codex.exe" => "Codex",
        _ => return None,
    };
    let kind = match probe.kind.as_str() {
        "store" if valid_family(&probe.family_name) && valid_app_id(&probe.app_id) && is_store_gui(executable) => {
            AppKind::Store
        }
        "direct" if is_direct_gui(executable) => AppKind::Direct,
        _ => return None,
    };
    Some(InstalledApp {
        kind,
        name: name.to_string(),
        executable: executable.to_string(),
        family_name: if kind == AppKind::Store {
            probe.family_name
        } else {
            String::new()
        },
        app_id: if kind == AppKind::Store {
            probe.app_id
        } else {
            String::new()
        },
    })
}

fn valid_family(family: &str) -> bool {
    let Some((name, publisher)) = family.rsplit_once('_') else {
        return false;
    };
    STORE_PACKAGES.contains(&name)
        && !publisher.is_empty()
        && publisher.chars().all(|ch| ch.is_ascii_alphanumeric())
}

fn valid_app_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '&'))
}

fn is_store_gui(path: &str) -> bool {
    let normal = normal_win(path);
    let mut parts = normal.rsplit('\\');
    let file = parts.next().unwrap_or("");
    let parent = parts.next().unwrap_or("");
    parent == "app" && matches!(file, "chatgpt.exe" | "codex.exe")
}

fn is_direct_gui(path: &str) -> bool {
    let normal = normal_win(path);
    if normal.contains(r"\windowsapps\")
        || normal.contains(r"\resources\")
        || normal.contains(r"\npm\")
        || normal.contains(r"\node_modules\")
    {
        return false;
    }
    let mut parts = normal.rsplit('\\');
    let file = parts.next().unwrap_or("");
    let parent = parts.next().unwrap_or("");
    let named = (parent == "chatgpt" && file == "chatgpt.exe")
        || (parent == "codex" && matches!(file, "codex.exe" | "chatgpt.exe"));
    named && (normal.contains(r"\program files\") || normal.contains(r"\programs\"))
}

fn normal_win(path: &str) -> String {
    let text = path.replace('/', "\\");
    let text = text
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or_else(|| text.strip_prefix(r"\\?\").unwrap_or(&text).to_string());
    text.trim_end_matches('\\').to_ascii_lowercase()
}

fn manifest_gui_app_id(root: &Path, executable: &Path, text: &str) -> Option<String> {
    use quick_xml::{events::Event, Reader};
    let expected = normal_win(&executable.to_string_lossy());
    let root = root.to_string_lossy();
    let mut reader = Reader::from_str(text);
    let mut matched = None;
    loop {
        match reader.read_event().ok()? {
            Event::Start(element) | Event::Empty(element)
                if element.local_name().as_ref() == b"Application" =>
            {
                let mut id = None;
                let mut relative = None;
                for attribute in element.attributes() {
                    let attribute = attribute.ok()?;
                    let value = attribute
                        .decode_and_unescape_value(reader.decoder())
                        .ok()?;
                    match attribute.key.local_name().as_ref() {
                        b"Id" => id = Some(value.into_owned()),
                        b"Executable" => relative = Some(value.into_owned()),
                        _ => {}
                    }
                }
                let (Some(app_id), Some(relative)) = (id, relative) else {
                    continue;
                };
                if !valid_app_id(&app_id) || !safe_manifest_relative(&relative) {
                    continue;
                }
                let candidate = join_win(&root, &relative);
                if normal_win(&candidate) == expected && is_store_gui(&candidate) {
                    if matched.is_some() {
                        return None;
                    }
                    matched = Some(app_id);
                }
            }
            Event::Eof => return matched,
            _ => {}
        }
    }
}

fn safe_manifest_relative(relative: &str) -> bool {
    !relative.is_empty()
        && !relative.contains(':')
        && !relative.starts_with(['/', '\\'])
        && !relative.split(['/', '\\']).any(|part| part == "..")
}

fn join_win(root: &str, relative: &str) -> String {
    format!(
        r"{}\{}",
        root.trim_end_matches(['\\', '/']),
        relative.replace('/', "\\").trim_start_matches(['\\', '/'])
    )
}

const DETECTION_SCRIPT: &str = r#"$ErrorActionPreference = 'Stop'
function Test-GuiRelative([string]$relative) {
  if (-not $relative) { return $false }
  if ([IO.Path]::IsPathRooted($relative)) { return $false }
  if ($relative.Split([char[]]@('\','/')) -contains '..') { return $false }
  $name = [IO.Path]::GetFileName($relative)
  if ($name -ine 'ChatGPT.exe' -and $name -ine 'Codex.exe') { return $false }
  $lower = $relative.Replace('/', '\').ToLowerInvariant()
  if ($lower.Contains('\resources\')) { return $false }
  $parts = $lower.Trim('\') -split '\\'
  return ($parts.Length -ge 2 -and $parts[-2] -eq 'app' -and ($parts[-1] -eq 'chatgpt.exe' -or $parts[-1] -eq 'codex.exe'))
}
function Emit-Store($pkg, $appId, $exe) {
  [PSCustomObject]@{
    kind = 'store'
    executable = $exe
    familyName = [string]$pkg.PackageFamilyName
    appId = [string]$appId
  } | ConvertTo-Json -Compress
  exit 0
}
function Consider-Package($pkg) {
  if (-not $pkg -or -not $pkg.InstallLocation) { return }
  $root = [IO.Path]::GetFullPath($pkg.InstallLocation).TrimEnd('\')
  $matches = @()
  $manifest = Get-AppxPackageManifest -Package $pkg -ErrorAction SilentlyContinue
  if (-not $manifest) { return }
  foreach ($application in @($manifest.Package.Applications.Application)) {
    $relative = [string]$application.Executable
    if (-not (Test-GuiRelative $relative)) { continue }
    $exe = [IO.Path]::GetFullPath((Join-Path $root ($relative.Replace('/','\'))))
    if (-not $exe.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
    $matches += [PSCustomObject]@{ Id = [string]$application.Id; Exe = $exe; Name = [IO.Path]::GetFileName($exe) }
  }
  $preferred = @($matches | Where-Object { $_.Name -ieq 'ChatGPT.exe' })
  if ($preferred.Count -eq 0) { $preferred = @($matches) }
  if ($preferred.Count -eq 1 -and $preferred[0].Id) {
    Emit-Store $pkg $preferred[0].Id $preferred[0].Exe
  }
}
foreach ($packageName in @('OpenAI.Codex','OpenAI.ChatGPT')) {
  $pkgs = @(Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Where-Object { $_.InstallLocation } | Sort-Object Version -Descending)
  foreach ($pkg in $pkgs) { Consider-Package $pkg }
}
$startApps = @(Get-StartApps -ErrorAction SilentlyContinue | Where-Object {
  $_.AppID -like 'OpenAI.Codex_*' -or $_.AppID -like 'OpenAI.ChatGPT_*'
})
foreach ($start in $startApps) {
  $parts = ([string]$start.AppID).Split('!', 2)
  if ($parts.Count -ne 2 -or -not $parts[0] -or -not $parts[1]) { continue }
  $pkg = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.PackageFamilyName -ieq $parts[0] } | Sort-Object Version -Descending | Select-Object -First 1)
  if ($pkg.Count -eq 1) { Consider-Package $pkg[0] }
}
function Emit-Direct([string]$exe) {
  if (-not $exe -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) { return }
  $full = [IO.Path]::GetFullPath($exe)
  $name = [IO.Path]::GetFileName($full)
  $parent = [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($full))
  $named = ($parent -ieq 'ChatGPT' -and $name -ieq 'ChatGPT.exe') -or ($parent -ieq 'Codex' -and ($name -ieq 'Codex.exe' -or $name -ieq 'ChatGPT.exe'))
  if (-not $named) { return }
  [PSCustomObject]@{
    kind = 'direct'
    executable = $full
    familyName = ''
    appId = ''
  } | ConvertTo-Json -Compress
  exit 0
}
$local = $env:LOCALAPPDATA
$pf = $env:ProgramFiles
$pf86 = ${env:ProgramFiles(x86)}
foreach ($exe in @(
  (Join-Path $local 'Programs\ChatGPT\ChatGPT.exe'),
  (Join-Path $local 'Programs\Codex\Codex.exe'),
  (Join-Path $local 'Programs\Codex\ChatGPT.exe'),
  (Join-Path $pf 'ChatGPT\ChatGPT.exe'),
  (Join-Path $pf 'Codex\Codex.exe'),
  (Join-Path $pf86 'ChatGPT\ChatGPT.exe')
)) { Emit-Direct $exe }
exit 3
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_accepts_store_chatgpt_and_rejects_the_bundled_cli() {
        let store = accept_probe(
            r#"{"kind":"store","executable":"C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1.0.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe","familyName":"OpenAI.Codex_2p2nqsd0c76g0","appId":"App"}"#,
        )
        .expect("store app");
        assert_eq!(store.name, "ChatGPT");
        assert_eq!(store.kind, AppKind::Store);
        assert_eq!(store.family_name, "OpenAI.Codex_2p2nqsd0c76g0");
        assert_eq!(store.app_id, "App");
        assert!(store.executable.ends_with(r"app\ChatGPT.exe"));
        assert!(accept_probe(
            r#"{"kind":"store","executable":"C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1.0.0_x64__2p2nqsd0c76g0\\app\\resources\\codex.exe","familyName":"OpenAI.Codex_2p2nqsd0c76g0","appId":"App"}"#
        )
        .is_none());
        assert!(accept_probe(
            r#"{"kind":"direct","executable":"C:\\Users\\me\\AppData\\Roaming\\npm\\codex.exe","familyName":"","appId":""}"#
        )
        .is_none());
    }

    #[test]
    fn probe_accepts_a_per_user_desktop_install() {
        let app = accept_probe(
            r#"{"kind":"direct","executable":"C:\\Users\\me\\AppData\\Local\\Programs\\Codex\\Codex.exe","familyName":"","appId":""}"#,
        )
        .expect("direct app");
        assert_eq!(app.name, "Codex");
        assert_eq!(app.kind, AppKind::Direct);
        assert!(app.family_name.is_empty());
        assert!(app.app_id.is_empty());
    }

    #[test]
    fn manifest_selects_the_gui_and_ignores_the_runner() {
        let root = Path::new(r"C:\Program Files\WindowsApps\OpenAI.Codex_26_x64__pub");
        let manifest = r#"<Package><Applications>
            <Application Id="Runner" Executable="app/resources/codex.exe"/>
            <Application Id="App" Executable="app\ChatGPT.exe"/>
        </Applications></Package>"#;
        let exe = root.join(r"app\ChatGPT.exe");
        assert_eq!(manifest_gui_app_id(root, &exe, manifest).as_deref(), Some("App"));
        let ambiguous = r#"<Package><Applications>
            <Application Id="One" Executable="app\ChatGPT.exe"/>
            <Application Id="Two" Executable="app/ChatGPT.exe"/>
        </Applications></Package>"#;
        assert!(manifest_gui_app_id(root, &exe, ambiguous).is_none());
    }

    #[test]
    fn activation_quotes_paths_and_does_not_carry_an_api_key() {
        let script = activation_script(
            "OpenAI.Codex_2p2nqsd0c76g0",
            "App",
            r"C:\Program Files\MyAgents\myagents.exe",
            "cGF5bG9hZA",
        )
        .expect("script");
        assert!(script.contains("Invoke-CommandInDesktopPackage"));
        assert!(script.contains("-PreventBreakaway"));
        assert!(script.contains(r"'C:\Program Files\MyAgents\myagents.exe'"));
        assert!(script.contains("--myagents-codex-package-launch cGF5bG9hZA"));
        assert!(!script.contains("OPENAI_API_KEY"));
        assert!(activation_script("OpenAI.Codex_pub'x", "App", "helper.exe", "cGF5").is_none());
    }

    #[test]
    fn detection_script_checks_the_store_package_and_skips_resources() {
        assert!(DETECTION_SCRIPT.contains("OpenAI.Codex"));
        assert!(DETECTION_SCRIPT.contains("OpenAI.ChatGPT"));
        assert!(DETECTION_SCRIPT.contains("ChatGPT.exe"));
        assert!(DETECTION_SCRIPT.contains(r"\resources\"));
        assert!(DETECTION_SCRIPT.contains("Get-StartApps"));
    }
}
