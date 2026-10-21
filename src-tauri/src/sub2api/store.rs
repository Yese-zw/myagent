//! Local credential store for the sub2api account grant.
//!
//! The grant lives in `~/.myagents/credentials/sub2api.json` instead of the OS
//! credential store. Writes are atomic and owner-only (0600 on unix, hardened
//! ACL on Windows) so an interrupted write cannot leave a truncated token file
//! behind and no other local account can read the bearer tokens.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::Grant;

pub const STORE_SCHEMA_VERSION: u32 = 1;
const STORE_DIR_NAME: &str = "credentials";
const STORE_FILE_NAME: &str = "sub2api.json";

#[derive(Clone, Default, Serialize, Deserialize)]
struct StoredAccount {
    schema_version: u32,
    #[serde(default)]
    grant: Option<Grant>,
    /// Full gateway secrets keyed by user id. Kept after logout so a later
    /// sign-in reuses the first registration key instead of creating another.
    #[serde(default)]
    gateway_keys: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreError {
    /// The file exists but cannot be parsed. The caller quarantines it and
    /// treats the account as signed out so the user can sign in again.
    Corrupt,
    /// The store could not be read or written on disk.
    Io,
}

pub fn store_path() -> Result<PathBuf, StoreError> {
    let root = crate::app_dirs::myagents_data_dir().ok_or(StoreError::Io)?;
    Ok(root.join(STORE_DIR_NAME).join(STORE_FILE_NAME))
}

fn read_store(path: &Path) -> Result<StoredAccount, StoreError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StoredAccount {
                schema_version: STORE_SCHEMA_VERSION,
                ..StoredAccount::default()
            });
        }
        Err(_) => return Err(StoreError::Io),
    };
    let stored: StoredAccount = serde_json::from_str(&raw).map_err(|_| StoreError::Corrupt)?;
    if stored.schema_version != STORE_SCHEMA_VERSION {
        return Err(StoreError::Corrupt);
    }
    if stored
        .grant
        .as_ref()
        .is_some_and(|grant| grant.access_token.trim().is_empty())
    {
        return Err(StoreError::Corrupt);
    }
    Ok(stored)
}

pub fn read_grant(path: &Path) -> Result<Option<Grant>, StoreError> {
    Ok(read_store(path)?.grant)
}

pub fn read_gateway_key(path: &Path, user_id: u64) -> Result<Option<String>, StoreError> {
    Ok(read_store(path)?
        .gateway_keys
        .get(&user_id.to_string())
        .filter(|key| key.len() >= 8)
        .cloned())
}

/// Persist the grant. Signing out clears the session but keeps the first
/// registration key so a later login does not mint another secret.
pub fn write_grant(path: &Path, grant: Option<&Grant>) -> Result<(), StoreError> {
    let parent = path.parent().ok_or(StoreError::Io)?;
    fs::create_dir_all(parent).map_err(|_| StoreError::Io)?;
    harden_directory_permissions(parent);
    let mut stored = match read_store(path) {
        Ok(stored) => stored,
        Err(StoreError::Corrupt) => StoredAccount {
            schema_version: STORE_SCHEMA_VERSION,
            ..StoredAccount::default()
        },
        Err(error) => return Err(error),
    };
    stored.schema_version = STORE_SCHEMA_VERSION;
    if let Some(existing) = stored.grant.as_ref() {
        if existing.api_key.len() >= 8 {
            stored
                .gateway_keys
                .insert(existing.user.id.to_string(), existing.api_key.clone());
        }
    }
    stored.grant = grant.cloned();
    if let Some(grant) = grant {
        if grant.api_key.len() >= 8 {
            stored
                .gateway_keys
                .insert(grant.user.id.to_string(), grant.api_key.clone());
        }
    }
    if stored.grant.is_none() && stored.gateway_keys.is_empty() {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(StoreError::Io),
        };
    }
    let bytes = serde_json::to_vec_pretty(&stored).map_err(|_| StoreError::Io)?;
    write_atomic(path, &bytes)
}

/// Keep the unusable file for diagnosis instead of deleting it outright.
pub fn quarantine_corrupt(path: &Path) {
    if fs::symlink_metadata(path).is_err() {
        return;
    }
    let quarantine =
        path.with_file_name(format!("sub2api.corrupt-{}.json", Uuid::new_v4().simple()));
    let _ = fs::rename(path, quarantine);
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    let parent = path.parent().ok_or(StoreError::Io)?;
    let tmp = parent.join(format!(
        ".sub2api.{}.{}.tmp",
        std::process::id(),
        Uuid::new_v4().simple()
    ));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp).map_err(|_| StoreError::Io)?;
    if file
        .write_all(bytes)
        .and_then(|()| file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(&tmp);
        return Err(StoreError::Io);
    }
    drop(file);
    if fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(&tmp);
        return Err(StoreError::Io);
    }
    harden_file_permissions(path);
    fsync_parent(parent)?;
    Ok(())
}

fn fsync_parent(parent: &Path) -> Result<(), StoreError> {
    #[cfg(unix)]
    {
        let directory = fs::File::open(parent).map_err(|_| StoreError::Io)?;
        directory.sync_all().map_err(|_| StoreError::Io)?;
    }
    #[cfg(not(unix))]
    let _ = parent;
    Ok(())
}

fn harden_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
            crate::ulog_warn!(
                "[sub2api] failed to harden credential permissions path={} error={}",
                path.display(),
                error
            );
        }
    }
    #[cfg(target_os = "windows")]
    harden_windows_acl(path);
}

#[cfg(target_os = "windows")]
fn harden_windows_acl(path: &Path) {
    let powershell =
        crate::system_binary::find("powershell").or_else(|| crate::system_binary::find("pwsh"));
    let Some(powershell) = powershell else {
        crate::ulog_warn!("[sub2api] PowerShell unavailable; cannot harden credential ACL");
        return;
    };
    if let Err(error) = crate::credential_permissions::harden_windows_acl(path, &powershell) {
        crate::ulog_warn!("[sub2api] failed to harden credential ACL: {}", error);
    }
}

fn harden_directory_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = fs::set_permissions(path, fs::Permissions::from_mode(0o700)) {
            crate::ulog_warn!(
                "[sub2api] failed to harden credential directory permissions path={} error={}",
                path.display(),
                error
            );
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sub2api::AccountUser;

    fn grant(token: &str) -> Grant {
        Grant {
            server_url: "https://example.test".into(),
            access_token: token.into(),
            refresh_token: "refresh".into(),
            user: AccountUser {
                id: 7,
                email: "a@example.test".into(),
                username: "Alice".into(),
            },
            api_key: String::new(),
        }
    }

    /// `Grant` deliberately has no Debug impl, so the assertions below match
    /// on the Result shape instead of formatting the credential itself.
    fn read_is_signed_out(path: &Path) -> bool {
        matches!(read_grant(path), Ok(None))
    }

    fn read_is_corrupt(path: &Path) -> bool {
        matches!(read_grant(path), Err(StoreError::Corrupt))
    }

    #[test]
    fn missing_store_reads_as_signed_out() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sub2api.json");
        assert!(read_is_signed_out(&path));
    }

    #[test]
    fn grant_round_trips_through_the_local_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sub2api.json");
        write_grant(&path, Some(&grant("token-1"))).unwrap();
        let restored = match read_grant(&path) {
            Ok(Some(grant)) => grant,
            Ok(None) => panic!("expected a stored grant, found none"),
            Err(error) => panic!("expected a stored grant, got {error:?}"),
        };
        assert_eq!(restored.access_token, "token-1");
        assert_eq!(restored.refresh_token, "refresh");
        assert_eq!(restored.user.email, "a@example.test");
    }

    #[test]
    fn signing_out_without_a_gateway_key_removes_the_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sub2api.json");
        write_grant(&path, Some(&grant("token-1"))).unwrap();
        assert!(path.exists());
        write_grant(&path, None).unwrap();
        assert!(!path.exists());
        write_grant(&path, None).unwrap();
        assert!(read_is_signed_out(&path));
    }

    #[test]
    fn signing_out_keeps_the_first_registration_key() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sub2api.json");
        let mut stored = grant("token-1");
        stored.api_key = "sk-first-registration".into();
        write_grant(&path, Some(&stored)).unwrap();
        write_grant(&path, None).unwrap();
        assert!(path.exists());
        assert!(read_is_signed_out(&path));
        assert_eq!(
            read_gateway_key(&path, 7).unwrap().as_deref(),
            Some("sk-first-registration")
        );
        stored.access_token = "token-2".into();
        stored.api_key.clear();
        write_grant(&path, Some(&stored)).unwrap();
        assert_eq!(
            read_gateway_key(&path, 7).unwrap().as_deref(),
            Some("sk-first-registration")
        );
    }

    #[test]
    fn credential_file_is_owner_only() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sub2api.json");
        write_grant(&path, Some(&grant("token-1"))).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn corrupt_store_is_reported_instead_of_reading_as_signed_out() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sub2api.json");
        fs::write(&path, "{not-json").unwrap();
        assert!(read_is_corrupt(&path));
        quarantine_corrupt(&path);
        assert!(!path.exists());
        assert!(temp.path().read_dir().unwrap().flatten().any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with("sub2api.corrupt-")));
    }

    #[test]
    fn unsupported_schema_version_is_corrupt() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sub2api.json");
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({ "schema_version": 99, "grant": null }))
                .unwrap(),
        )
        .unwrap();
        assert!(read_is_corrupt(&path));
    }

    #[test]
    fn a_grant_without_an_access_token_is_corrupt() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sub2api.json");
        write_grant(&path, Some(&grant("token-1"))).unwrap();
        let mut stored: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        stored["grant"]["access_token"] = serde_json::Value::String(String::new());
        fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read_is_corrupt(&path));
    }
}
