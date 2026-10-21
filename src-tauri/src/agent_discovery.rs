use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug)]
pub struct DiscoveryError(pub &'static str);

impl serde::Serialize for DiscoveryError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.0)
    }
}

#[tauri::command]
pub(crate) async fn cmd_agent_discovery(
    manager: tauri::State<'_, crate::sidecar::ManagedSidecarManager>,
) -> Result<Value, DiscoveryError> {
    let dispatch = manager
        .lock()
        .map_err(|_| DiscoveryError("TARGET_OWNER_UNAVAILABLE"))?
        .acquire_global_dispatch()
        .map_err(|_| DiscoveryError("TARGET_OWNER_UNAVAILABLE"))?;
    let response = crate::local_http::json_client(Duration::from_secs(20))
        .post(
            dispatch
                .url_for_path("/api/admin/agent/discovery")
                .map_err(|_| DiscoveryError("TARGET_OWNER_UNAVAILABLE"))?,
        )
        .header(
            crate::external_cli::INTERNAL_TOKEN_HEADER,
            crate::external_cli::internal_token(),
        )
        .json(&json!({ "localOnly": true }))
        .send()
        .await
        .map_err(|_| DiscoveryError("TARGET_OWNER_UNAVAILABLE"))?;
    let value: Value = response
        .error_for_status()
        .map_err(|_| DiscoveryError("TARGET_OWNER_UNAVAILABLE"))?
        .json()
        .await
        .map_err(|_| DiscoveryError("TARGET_RECEIPT_INVALID"))?;
    if value["success"] != true {
        return Err(DiscoveryError("TARGET_RECEIPT_INVALID"));
    }
    Ok(value.get("data").cloned().unwrap_or(Value::Null))
}
