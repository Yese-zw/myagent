//! App-owned sub2api login. The packaged origin identifies the deployment;
//! access/refresh tokens stay in the local credential file and this process.
mod captcha;
mod codex_launch;
mod store;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tokio::sync::Mutex;

const EVENT: &str = "sub2api-account:changed";
const RESPONSE_LIMIT: usize = 256 * 1024;
// Active announcements include markdown bodies. Keep the list bounded, but
// larger than credential responses so a normal notice feed is not truncated.
const ANNOUNCEMENT_LIMIT: usize = 1024 * 1024;
// Public settings may include embedded site logos and community images. Keep
// credential responses small while allowing the server's branding payload.
const PUBLIC_SETTINGS_LIMIT: usize = 4 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountUser {
    pub id: u64,
    pub email: String,
    #[serde(default)]
    pub username: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    pub server_url: String,
    pub user: Option<AccountUser>,
}

#[derive(Clone, Serialize, Debug)]
pub struct AuthError {
    pub code: String,
}

impl AuthError {
    fn new(code: &str) -> Self {
        Self { code: code.into() }
    }
}

type Result<T> = std::result::Result<T, AuthError>;

// Never derive Debug or PartialEq: this value contains bearer credentials.
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Grant {
    server_url: String,
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    user: AccountUser,
    #[serde(default)]
    api_key: String,
}

#[derive(Default)]
struct AccountState {
    initialized: bool,
    server_url: String,
    grant: Option<Grant>,
}

#[derive(Default)]
pub struct Sub2apiAccount {
    // One app owner serializes token rotation, service changes and logout.
    operation: Mutex<()>,
    state: Mutex<AccountState>,
    captcha: captcha::CaptchaState,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Agreement {
    pub id: String,
    pub title: String,
    pub content_md: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct PublicSettings {
    pub site_name: String,
    /// Website logo. May be an absolute URL, a root-relative path, or a data URL.
    pub site_logo: String,
    pub registration_enabled: bool,
    pub email_verify_enabled: bool,
    pub invitation_code_enabled: bool,
    pub affiliate_enabled: bool,
    pub registration_email_suffix_whitelist: Vec<String>,
    pub login_agreement_enabled: bool,
    pub login_agreement_documents: Vec<Agreement>,
    pub turnstile_enabled: bool,
    pub turnstile_site_key: String,
    pub tencent_captcha_enabled: bool,
    pub aliyun_captcha_enabled: bool,
    pub balance_low_notify_enabled: bool,
    pub balance_low_notify_threshold: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInput {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub verify_code: String,
    #[serde(default)]
    pub invitation_code: String,
    #[serde(default)]
    pub aff_code: String,
    #[serde(default)]
    pub agreed: bool,
}

pub fn normalize_server_url(raw: &str) -> Result<String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| AuthError::new("INVALID_SERVER"))?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(AuthError::new("INVALID_SERVER"));
    }
    Ok(url.origin().ascii_serialization())
}

struct PackagedDefaults {
    server_url: String,
    default_group_id: u64,
}

fn packaged_defaults() -> Result<PackagedDefaults> {
    let defaults: Value =
        serde_json::from_str(include_str!("../../../src/shared/sub2api-defaults.json"))
            .map_err(|_| AuthError::new("STORE_ERROR"))?;
    // Deployment identity is owned by the packaged configuration. User
    // config and Renderer commands cannot redirect the origin or key group.
    let server_url = normalize_server_url(defaults["serverUrl"].as_str().unwrap_or(""))?;
    let default_group_id = defaults["defaultGroupId"]
        .as_u64()
        .filter(|id| *id > 0)
        .ok_or_else(|| AuthError::new("STORE_ERROR"))?;
    Ok(PackagedDefaults {
        server_url,
        default_group_id,
    })
}

async fn read_saved_state() -> Result<AccountState> {
    tauri::async_runtime::spawn_blocking(|| {
        let server_url = packaged_defaults()?.server_url;
        let path = store::store_path().map_err(|_| AuthError::new("STORE_ERROR"))?;
        let stored = match store::read_grant(&path) {
            Ok(grant) => grant,
            // A damaged file must not lock the user out of the account panel.
            // Keep it for diagnosis and continue as signed out.
            Err(store::StoreError::Corrupt) => {
                crate::ulog_warn!(
                    "[sub2api] credential file is unreadable; quarantining it path={}",
                    path.display()
                );
                store::quarantine_corrupt(&path);
                None
            }
            Err(store::StoreError::Io) => return Err(AuthError::new("STORE_ERROR")),
        };
        let grant = match stored {
            Some(grant) if grant.server_url == server_url => Some(grant),
            // A grant for another origin can never be used again. Drop it
            // instead of leaving a dead credential file on disk.
            Some(_) => {
                let _ = store::write_grant(&path, None);
                None
            }
            None => None,
        };
        Ok(AccountState {
            initialized: true,
            server_url,
            grant,
        })
    })
    .await
    .map_err(|_| AuthError::new("STORE_ERROR"))?
}

async fn save_grant(grant: Option<Grant>) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = store::store_path().map_err(|_| AuthError::new("STORE_ERROR"))?;
        store::write_grant(&path, grant.as_ref()).map_err(|_| AuthError::new("STORE_ERROR"))
    })
    .await
    .map_err(|_| AuthError::new("STORE_ERROR"))?
}

fn require_main(window: &WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(AuthError::new("NOT_ALLOWED"))
    }
}

fn notify(app: &AppHandle) {
    // Invalidation only. No credentials or account data on the event bus.
    let _ = app.emit_to("main", EVENT, ());
}

impl Sub2apiAccount {
    async fn initialize(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        if !state.initialized {
            *state = read_saved_state().await?;
        }
        Ok(())
    }

    async fn snapshot(&self) -> AccountSnapshot {
        let state = self.state.lock().await;
        AccountSnapshot {
            server_url: state.server_url.clone(),
            user: state.grant.as_ref().map(|grant| grant.user.clone()),
        }
    }
}

fn response_error(status: u16, reason: &str) -> AuthError {
    let code = match reason {
        "INVALID_CREDENTIALS" | "INVALID_PASSWORD" | "INVALID_EMAIL_OR_PASSWORD" => {
            "INVALID_CREDENTIALS"
        }
        "EMAIL_EXISTS" | "EMAIL_ALREADY_EXISTS" => "EMAIL_EXISTS",
        "INVALID_VERIFY_CODE" | "INVALID_VERIFICATION_CODE" | "VERIFICATION_CODE_EXPIRED" => {
            "INVALID_VERIFY_CODE"
        }
        "REGISTRATION_DISABLED" => "REGISTRATION_DISABLED",
        "USER_NOT_ACTIVE" | "USER_DISABLED" => "USER_DISABLED",
        "TOO_MANY_PENDING" => "TOO_MANY_PENDING",
        "CANCEL_RATE_LIMITED" => "CANCEL_RATE_LIMITED",
        "DAILY_LIMIT_EXCEEDED" => "DAILY_LIMIT_EXCEEDED",
        "PAYMENT_INVALID_AMOUNT" => "PAYMENT_INVALID_AMOUNT",
        "PAYMENT_DISABLED" | "BALANCE_PAYMENT_DISABLED" => "PAYMENT_DISABLED",
        "PAYMENT_GATEWAY_ERROR" => "PAYMENT_GATEWAY_ERROR",
        _ => match status {
            401 => "UNAUTHORIZED",
            403 => "FORBIDDEN",
            429 => "RATE_LIMITED",
            400 | 422 => "INVALID_INPUT",
            _ => "SERVER_ERROR",
        },
    };
    AuthError::new(code)
}

async fn request(
    server: &str,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
) -> Result<Value> {
    let method = if body.is_some() {
        reqwest::Method::POST
    } else {
        reqwest::Method::GET
    };
    request_method(server, path, body, bearer, method).await
}

async fn request_method(
    server: &str,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
    method: reqwest::Method,
) -> Result<Value> {
    let server = normalize_server_url(server)?;
    let loopback = server.starts_with("http://");
    // This client is an external account-service client, not a Sidecar client.
    #[allow(clippy::disallowed_methods)]
    let builder = if loopback {
        crate::local_http::builder()
    } else {
        reqwest::Client::builder()
    };
    let builder = builder
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none());
    let client = if loopback {
        builder
            .build()
            .map_err(|_| AuthError::new("NETWORK_ERROR"))?
    } else {
        crate::proxy_config::build_client_with_proxy(builder)
            .map_err(|_| AuthError::new("NETWORK_ERROR"))?
    };
    let url = format!("{server}/api/v1/{path}");
    let request = client.request(method, url);
    let request = match body {
        Some(body) => request.json(&body),
        None => request,
    };
    let request = if let Some(bearer) = bearer {
        request.bearer_auth(bearer)
    } else {
        request
    };
    let mut response = request
        .send()
        .await
        .map_err(|_| AuthError::new("NETWORK_ERROR"))?;
    let status = response.status().as_u16();
    let route = path.split('?').next().unwrap_or(path);
    // Checkout info carries operator-configured help markdown and images.
    let response_limit = if route == "settings/public" || route == "payment/checkout-info" {
        PUBLIC_SETTINGS_LIMIT
    } else if route == "announcements" || route.starts_with("announcements/") {
        ANNOUNCEMENT_LIMIT
    } else {
        RESPONSE_LIMIT
    };
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AuthError::new("NETWORK_ERROR"))?
    {
        if bytes.len() + chunk.len() > response_limit {
            return Err(AuthError::new("INVALID_RESPONSE"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| response_error(status, ""))?;
    if !(200..300).contains(&status) || value.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(response_error(
            status,
            value.get("reason").and_then(Value::as_str).unwrap_or(""),
        ));
    }
    value
        .get("data")
        .cloned()
        .ok_or_else(|| AuthError::new("INVALID_RESPONSE"))
}

fn account_api_request(
    operation: &str,
    payload: Option<Value>,
) -> Result<(String, reqwest::Method, Option<Value>)> {
    let mut payload = match payload {
        Some(Value::Object(object)) => object,
        None => serde_json::Map::new(),
        _ => return Err(AuthError::new("INVALID_INPUT")),
    };
    let (path, method) = match operation {
        "profile" => ("user/profile".into(), reqwest::Method::GET),
        "update-profile" => ("user".into(), reqwest::Method::PUT),
        "change-password" => ("user/password".into(), reqwest::Method::PUT),
        "send-notify-email-code" => ("user/notify-email/send-code".into(), reqwest::Method::POST),
        "verify-notify-email" => ("user/notify-email/verify".into(), reqwest::Method::POST),
        "remove-notify-email" => ("user/notify-email".into(), reqwest::Method::DELETE),
        "toggle-notify-email" => ("user/notify-email/toggle".into(), reqwest::Method::PUT),
        "keys" => ("keys".into(), reqwest::Method::GET),
        "groups" => ("groups/available".into(), reqwest::Method::GET),
        "create-key" => ("keys".into(), reqwest::Method::POST),
        "update-key" | "delete-key" | "cancel-order" | "get-order" | "announcement-read" => {
            let id = payload
                .remove("id")
                .and_then(|id| id.as_u64())
                .filter(|id| *id > 0)
                .ok_or_else(|| AuthError::new("INVALID_INPUT"))?;
            match operation {
                "update-key" => (format!("keys/{id}"), reqwest::Method::PUT),
                "delete-key" => (format!("keys/{id}"), reqwest::Method::DELETE),
                "announcement-read" => (format!("announcements/{id}/read"), reqwest::Method::POST),
                "get-order" => (format!("payment/orders/{id}"), reqwest::Method::GET),
                _ => (format!("payment/orders/{id}/cancel"), reqwest::Method::POST),
            }
        }
        "announcements" => ("announcements".into(), reqwest::Method::GET),
        "usage" => ("usage".into(), reqwest::Method::GET),
        "usage-stats" => ("usage/stats".into(), reqwest::Method::GET),
        "dashboard-stats" => ("usage/dashboard/stats".into(), reqwest::Method::GET),
        "dashboard-trend" => ("usage/dashboard/trend".into(), reqwest::Method::GET),
        "dashboard-models" => ("usage/dashboard/models".into(), reqwest::Method::GET),
        "orders" => ("payment/orders/my".into(), reqwest::Method::GET),
        "checkout-info" => ("payment/checkout-info".into(), reqwest::Method::GET),
        "create-order" => ("payment/orders".into(), reqwest::Method::POST),
        "verify-order" => ("payment/orders/verify".into(), reqwest::Method::POST),
        "redeem" => ("redeem".into(), reqwest::Method::POST),
        "redeem-history" => ("redeem/history".into(), reqwest::Method::GET),
        "affiliate" => ("user/aff".into(), reqwest::Method::GET),
        "affiliate-transfer" => ("user/aff/transfer".into(), reqwest::Method::POST),
        _ => return Err(AuthError::new("INVALID_INPUT")),
    };
    match operation {
        "change-password" => {
            let old_password = payload
                .get("old_password")
                .and_then(Value::as_str)
                .unwrap_or("");
            let new_password = payload
                .get("new_password")
                .and_then(Value::as_str)
                .unwrap_or("");
            if old_password.is_empty() || new_password.len() < 8 || new_password.len() > 1024 {
                return Err(AuthError::new("INVALID_INPUT"));
            }
            payload.retain(|key, _| key == "old_password" || key == "new_password");
        }
        "create-key" => {
            let name = payload.get("name").and_then(Value::as_str).unwrap_or("");
            if name.is_empty() || name.len() > 100 {
                return Err(AuthError::new("INVALID_INPUT"));
            }
            let group_id = packaged_defaults()?.default_group_id;
            payload.retain(|key, _| key == "name");
            payload.insert("group_id".into(), json!(group_id));
        }
        "send-notify-email-code"
        | "verify-notify-email"
        | "remove-notify-email"
        | "toggle-notify-email" => {
            let email = payload.get("email").and_then(Value::as_str).unwrap_or("");
            if !email.contains('@') || email.len() > 320 {
                return Err(AuthError::new("INVALID_INPUT"));
            }
            if operation == "verify-notify-email" {
                let code = payload.get("code").and_then(Value::as_str).unwrap_or("");
                if code.len() != 6 {
                    return Err(AuthError::new("INVALID_INPUT"));
                }
            }
            if operation == "toggle-notify-email"
                && !payload.get("disabled").is_some_and(Value::is_boolean)
            {
                return Err(AuthError::new("INVALID_INPUT"));
            }
            payload.retain(|key, _| matches!(key.as_str(), "email" | "code" | "disabled"));
        }
        "announcement-read" | "get-order" => {
            payload.clear();
        }
        "create-order" => {
            // Desktop recharge only creates balance orders. The client cannot
            // pick a plan, return URL or WeChat in-app flow; the return URL is
            // derived from the signed-in server in `authenticated_api`.
            let amount = payload
                .get("amount")
                .and_then(Value::as_f64)
                .filter(|amount| amount.is_finite() && *amount > 0.0 && *amount <= 1_000_000.0)
                .ok_or_else(|| AuthError::new("INVALID_INPUT"))?;
            let payment_type = payload
                .get("payment_type")
                .and_then(Value::as_str)
                .filter(|kind| {
                    !kind.is_empty()
                        && kind.len() <= 64
                        && kind
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                })
                .ok_or_else(|| AuthError::new("INVALID_INPUT"))?
                .to_string();
            payload.clear();
            payload.insert("amount".into(), json!(amount));
            payload.insert("payment_type".into(), json!(payment_type));
            payload.insert("order_type".into(), json!("balance"));
            payload.insert("is_mobile".into(), json!(false));
            payload.insert("payment_source".into(), json!("hosted_redirect"));
        }
        "verify-order" => {
            let out_trade_no = payload
                .get("out_trade_no")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty() && value.len() <= 128)
                .ok_or_else(|| AuthError::new("INVALID_INPUT"))?
                .to_string();
            payload.clear();
            payload.insert("out_trade_no".into(), json!(out_trade_no));
        }
        "announcements" | "checkout-info" | "affiliate" | "affiliate-transfer"
            if !payload.is_empty() =>
        {
            return Err(AuthError::new("INVALID_INPUT"));
        }
        _ => {}
    }
    if method == reqwest::Method::GET {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in payload {
            if !matches!(
                key.as_str(),
                "page"
                    | "page_size"
                    | "search"
                    | "status"
                    | "model"
                    | "start_date"
                    | "end_date"
                    | "granularity"
                    | "timezone"
                    | "api_key_id"
                    | "order_type"
                    | "payment_type"
            ) {
                return Err(AuthError::new("INVALID_INPUT"));
            }
            let value = match value {
                Value::String(value) => value,
                Value::Number(value) => value.to_string(),
                Value::Null => continue,
                _ => return Err(AuthError::new("INVALID_INPUT")),
            };
            if value.len() > 1024 {
                return Err(AuthError::new("INVALID_INPUT"));
            }
            query.append_pair(&key, &value);
        }
        let query = query.finish();
        return Ok((
            if query.is_empty() {
                path
            } else {
                format!("{path}?{query}")
            },
            method,
            None,
        ));
    }
    Ok((path, method, Some(Value::Object(payload))))
}

async fn authenticated_api(
    manager: &Sub2apiAccount,
    operation: &str,
    payload: Option<Value>,
) -> Result<Value> {
    let (path, method, mut payload) = account_api_request(operation, payload)?;
    let mut grant = manager
        .state
        .lock()
        .await
        .grant
        .clone()
        .ok_or_else(|| AuthError::new("UNAUTHORIZED"))?;
    if operation == "create-order" {
        if let Some(Value::Object(object)) = payload.as_mut() {
            object.insert(
                "return_url".into(),
                json!(format!("{}/payment/result", grant.server_url)),
            );
        }
    }
    let response = request_method(
        &grant.server_url,
        &path,
        payload.clone(),
        Some(&grant.access_token),
        method.clone(),
    )
    .await;
    match response {
        Err(error) if error.code == "UNAUTHORIZED" && !grant.refresh_token.is_empty() => {
            let tokens = request(
                &grant.server_url,
                "auth/refresh",
                Some(json!({"refresh_token": grant.refresh_token})),
                None,
            )
            .await?;
            grant.access_token = token(&tokens, "access_token")?;
            grant.refresh_token = token(&tokens, "refresh_token")?;
            save_grant(Some(grant.clone())).await?;
            manager.state.lock().await.grant = Some(grant.clone());
            request_method(
                &grant.server_url,
                &path,
                payload,
                Some(&grant.access_token),
                method,
            )
            .await
        }
        result => result,
    }
}

#[tauri::command]
pub async fn cmd_sub2api_account_api(
    app: AppHandle,
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
    operation: String,
    payload: Option<Value>,
) -> Result<Value> {
    require_main(&window)?;
    let _operation = manager.operation.lock().await;
    manager.initialize().await?;
    let result = authenticated_api(&manager, operation.as_str(), payload).await;
    match &result {
        Ok(value) if operation == "profile" || operation == "update-profile" => {
            let user = user_from_response(value.clone())?;
            let mut grant = manager
                .state
                .lock()
                .await
                .grant
                .clone()
                .ok_or_else(|| AuthError::new("UNAUTHORIZED"))?;
            if grant.user.id != user.id {
                return Err(AuthError::new("INVALID_RESPONSE"));
            }
            if grant.user != user {
                grant.user = user;
                save_grant(Some(grant.clone())).await?;
                manager.state.lock().await.grant = Some(grant);
                notify(&app);
            }
        }
        Err(error) if error.code == "UNAUTHORIZED" || error.code == "USER_DISABLED" => {
            save_grant(None).await?;
            manager.state.lock().await.grant = None;
            notify(&app);
        }
        _ => {}
    }
    result
}

fn user_from_response(value: Value) -> Result<AccountUser> {
    let user: AccountUser =
        serde_json::from_value(value).map_err(|_| AuthError::new("INVALID_RESPONSE"))?;
    if user.id == 0
        || user.email.len() > 320
        || !user.email.contains('@')
        || user.username.len() > 1024
    {
        return Err(AuthError::new("INVALID_RESPONSE"));
    }
    Ok(user)
}

fn extract_gateway_key(value: &Value) -> Option<String> {
    const KEYS: [&str; 4] = ["key", "api_key", "secret", "apiKey"];
    let candidates = [
        Some(value),
        value.get("data"),
        value.get("item"),
        value.get("key"),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.is_object() {
            for name in KEYS {
                if let Some(key) = candidate
                    .get(name)
                    .and_then(Value::as_str)
                    .filter(|key| key.len() >= 8 && key.len() <= 16_384)
                {
                    return Some(key.to_owned());
                }
            }
        }
    }
    None
}

fn account_has_keys(value: &Value) -> bool {
    !key_items(value).is_empty()
}

fn key_items(value: &Value) -> &[Value] {
    if let Some(items) = value.as_array() {
        return items;
    }
    if let Some(items) = value.get("items").and_then(Value::as_array) {
        return items;
    }
    if let Some(data) = value.get("data") {
        return key_items(data);
    }
    &[]
}

fn json_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(number)) => number.as_u64().filter(|id| *id > 0),
        Some(Value::String(text)) => text.trim().parse::<u64>().ok().filter(|id| *id > 0),
        _ => None,
    }
}

fn json_count(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(text)) => text.trim().parse().ok(),
        _ => None,
    }
}

/// Group assigned to the key. Accepts the flat field and a nested group object.
fn key_group_id(item: &Value) -> Option<u64> {
    json_u64(item.get("group_id"))
        .or_else(|| json_u64(item.get("group").and_then(|group| group.get("id"))))
}

fn listed_key_secret(item: &Value) -> Option<String> {
    // List responses sometimes mask the secret. A masked value cannot be used
    // as the gateway credential and must not replace a secret saved earlier.
    extract_gateway_key(item).filter(|key| !key.contains('*'))
}

fn find_registration_group_key(items: &[Value], group_id: u64) -> Option<&Value> {
    items
        .iter()
        .find(|item| key_group_id(item) == Some(group_id))
}

fn usable_gateway_key(value: &str) -> Option<String> {
    let key = value.trim();
    (key.len() >= 8 && key.len() <= 16_384).then(|| key.to_owned())
}

fn gateway_base_url(server_url: &str) -> String {
    format!("{server_url}/v1")
}

async fn remember_gateway_key(manager: &Sub2apiAccount, api_key: String) -> Result<String> {
    let mut grant = manager
        .state
        .lock()
        .await
        .grant
        .clone()
        .ok_or_else(|| AuthError::new("UNAUTHORIZED"))?;
    grant.api_key = api_key.clone();
    save_grant(Some(grant.clone())).await?;
    manager.state.lock().await.grant = Some(grant);
    Ok(api_key)
}

async fn stored_gateway_key(user_id: u64) -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = store::store_path().map_err(|_| AuthError::new("STORE_ERROR"))?;
        store::read_gateway_key(&path, user_id).map_err(|_| AuthError::new("STORE_ERROR"))
    })
    .await
    .map_err(|_| AuthError::new("STORE_ERROR"))?
}

const KEY_PAGE_SIZE: u64 = 100;
const KEY_PAGE_LIMIT: u64 = 10;

async fn list_account_keys(manager: &Sub2apiAccount) -> Result<Vec<Value>> {
    let mut collected = Vec::new();
    let mut page = 1u64;
    loop {
        let listed = authenticated_api(
            manager,
            "keys",
            Some(json!({"page": page, "page_size": KEY_PAGE_SIZE})),
        )
        .await?;
        let items = key_items(&listed);
        let count = items.len();
        let first_id = items.first().and_then(|item| json_u64(item.get("id")));
        let repeated_page = page > 1
            && first_id.is_some()
            && collected
                .first()
                .and_then(|item: &Value| json_u64(item.get("id")))
                == first_id;
        if count == 0 || repeated_page {
            break;
        }
        collected.extend(items.iter().cloned());
        let total = json_count(listed.get("total"));
        let reported_page_size = json_count(listed.get("page_size")).filter(|size| *size > 0);
        let more = match total {
            Some(total) => (collected.len() as u64) < total,
            None => (count as u64) >= reported_page_size.unwrap_or(KEY_PAGE_SIZE),
        };
        if !more || page >= KEY_PAGE_LIMIT {
            break;
        }
        page += 1;
    }
    Ok(collected)
}

/// Login and registration both require a key in the packaged default group,
/// the same group assigned when registration creates `LSAGENT`. Keys in other
/// groups do not satisfy this, and a stored secret is not used until the
/// server list has been checked.
async fn ensure_registration_group_key(manager: &Sub2apiAccount) -> Result<String> {
    let group_id = packaged_defaults()?.default_group_id;
    let items = list_account_keys(manager).await?;
    if let Some(existing) = find_registration_group_key(&items, group_id) {
        if let Some(secret) = listed_key_secret(existing) {
            return remember_gateway_key(manager, secret).await;
        }
        let grant = manager
            .state
            .lock()
            .await
            .grant
            .clone()
            .ok_or_else(|| AuthError::new("UNAUTHORIZED"))?;
        if let Some(stored) = usable_gateway_key(&grant.api_key) {
            return remember_gateway_key(manager, stored).await;
        }
        if let Some(stored) = stored_gateway_key(grant.user.id).await? {
            return remember_gateway_key(manager, stored).await;
        }
        return Err(AuthError::new("GATEWAY_KEY_MISSING"));
    }
    let created =
        authenticated_api(manager, "create-key", Some(json!({"name": "LSAGENT"}))).await?;
    let api_key =
        extract_gateway_key(&created).ok_or_else(|| AuthError::new("INVALID_RESPONSE"))?;
    remember_gateway_key(manager, api_key).await
}

/// Reuse a stored gateway secret. Callers that must not create a key use this
/// path. Login and registration use `ensure_registration_group_key` instead.
async fn provision_gateway_key(manager: &Sub2apiAccount, allow_create: bool) -> Result<String> {
    let grant = manager
        .state
        .lock()
        .await
        .grant
        .clone()
        .ok_or_else(|| AuthError::new("UNAUTHORIZED"))?;
    if let Some(existing) = usable_gateway_key(&grant.api_key) {
        return remember_gateway_key(manager, existing).await;
    }
    if let Some(existing) = stored_gateway_key(grant.user.id).await? {
        return remember_gateway_key(manager, existing).await;
    }
    let listed = authenticated_api(manager, "keys", None).await?;
    if account_has_keys(&listed) {
        return Err(AuthError::new("GATEWAY_KEY_MISSING"));
    }
    if !allow_create {
        return Err(AuthError::new("GATEWAY_KEY_MISSING"));
    }
    let created =
        authenticated_api(manager, "create-key", Some(json!({"name": "LSAGENT"}))).await?;
    let api_key =
        extract_gateway_key(&created).ok_or_else(|| AuthError::new("INVALID_RESPONSE"))?;
    remember_gateway_key(manager, api_key).await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCredentials {
    pub base_url: String,
    pub api_key: String,
}

fn token(value: &Value, name: &str) -> Result<String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 16_384)
        .map(str::to_owned)
        .ok_or_else(|| AuthError::new("INVALID_RESPONSE"))
}

async fn settings(server: &str) -> Result<PublicSettings> {
    serde_json::from_value(request(server, "settings/public", None, None).await?)
        .map_err(|_| AuthError::new("INVALID_RESPONSE"))
}

#[tauri::command]
pub async fn cmd_sub2api_get_account(
    app: AppHandle,
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
    refresh: bool,
) -> Result<AccountSnapshot> {
    require_main(&window)?;
    let _operation = manager.operation.lock().await;
    manager.initialize().await?;
    let grant = manager.state.lock().await.grant.clone();
    if refresh {
        if let Some(mut grant) = grant {
            let response = request(
                &grant.server_url,
                "auth/me",
                None,
                Some(&grant.access_token),
            )
            .await;
            let response = match response {
                Err(error) if error.code == "UNAUTHORIZED" && !grant.refresh_token.is_empty() => {
                    match request(
                        &grant.server_url,
                        "auth/refresh",
                        Some(json!({"refresh_token": grant.refresh_token})),
                        None,
                    )
                    .await
                    {
                        Ok(tokens) => {
                            grant.access_token = token(&tokens, "access_token")?;
                            grant.refresh_token = token(&tokens, "refresh_token")?;
                            // Persist the rotating pair before further network I/O.
                            save_grant(Some(grant.clone())).await?;
                            manager.state.lock().await.grant = Some(grant.clone());
                            request(
                                &grant.server_url,
                                "auth/me",
                                None,
                                Some(&grant.access_token),
                            )
                            .await
                        }
                        Err(error) => Err(error),
                    }
                }
                response => response,
            };
            match response {
                Ok(value) => {
                    let user = user_from_response(value)?;
                    if user.id != grant.user.id {
                        return Err(AuthError::new("INVALID_RESPONSE"));
                    }
                    grant.user = user;
                    save_grant(Some(grant.clone())).await?;
                    manager.state.lock().await.grant = Some(grant);
                }
                Err(error) if error.code == "UNAUTHORIZED" || error.code == "USER_DISABLED" => {
                    save_grant(None).await?;
                    manager.state.lock().await.grant = None;
                    notify(&app);
                }
                Err(error) => return Err(error), // Transient errors never sign the user out.
            }
        }
    }
    Ok(manager.snapshot().await)
}

#[tauri::command]
pub async fn cmd_sub2api_public_settings(
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
) -> Result<PublicSettings> {
    require_main(&window)?;
    let _operation = manager.operation.lock().await;
    manager.initialize().await?;
    let server = manager.state.lock().await.server_url.clone();
    settings(&server).await
}

#[tauri::command]
pub async fn cmd_sub2api_authenticate(
    app: AppHandle,
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
    input: AuthInput,
    register: bool,
) -> Result<AccountSnapshot> {
    require_main(&window)?;
    if input.email.trim().len() > 320
        || !input.email.trim().contains('@')
        || input.password.is_empty()
        || input.password.len() > 1024
    {
        return Err(AuthError::new("INVALID_INPUT"));
    }
    let _operation = manager.operation.lock().await;
    manager.initialize().await?;
    let server = manager.state.lock().await.server_url.clone();
    let settings = settings(&server).await?;
    if settings.login_agreement_enabled && !input.agreed {
        return Err(AuthError::new("AGREEMENT_REQUIRED"));
    }
    if register && !settings.registration_enabled {
        return Err(AuthError::new("REGISTRATION_DISABLED"));
    }
    let needs_captcha =
        !(register && settings.email_verify_enabled && !input.verify_code.is_empty());
    let proof = if needs_captcha {
        captcha::proof(&app, &manager.captcha, &server, &settings).await?
    } else {
        String::new()
    };
    let payload = json!({
        "email": input.email.trim(), "password": input.password,
        "verify_code": input.verify_code,
        "invitation_code": input.invitation_code,
        "aff_code": input.aff_code,
        "turnstile_token": proof,
    });
    let response = request(
        &server,
        if register {
            "auth/register"
        } else {
            "auth/login"
        },
        Some(payload),
        None,
    )
    .await?;
    if response.get("requires_2fa").and_then(Value::as_bool) == Some(true) {
        // Never bypass a server-enforced account requirement or pretend it is logged in.
        return Err(AuthError::new("ACCOUNT_REQUIRES_2FA"));
    }
    let access_token = token(&response, "access_token")?;
    let user = user_from_response(request(&server, "auth/me", None, Some(&access_token)).await?)?;
    let previous = manager.state.lock().await.grant.clone();
    let reused_key = previous
        .and_then(|grant| (grant.user.id == user.id).then_some(grant.api_key))
        .and_then(|key| usable_gateway_key(&key));
    let reused_key = match reused_key {
        Some(key) => Some(key),
        None => stored_gateway_key(user.id).await?,
    };
    let grant = Grant {
        server_url: server,
        access_token,
        refresh_token: response
            .get("refresh_token")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        user,
        api_key: reused_key.clone().unwrap_or_default(),
    };
    if grant.refresh_token.len() > 16_384 {
        return Err(AuthError::new("INVALID_RESPONSE"));
    }
    save_grant(Some(grant.clone())).await?;
    manager.state.lock().await.grant = Some(grant);
    // Login and registration both check the packaged default group. A missing
    // key is created even when the account already has keys in other groups.
    if let Err(error) = ensure_registration_group_key(&manager).await {
        crate::ulog_warn!("[sub2api] gateway key provision failed code={}", error.code);
    }
    notify(&app);
    Ok(manager.snapshot().await)
}

#[tauri::command]
pub async fn cmd_sub2api_gateway(
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
) -> Result<GatewayCredentials> {
    require_main(&window)?;
    let _operation = manager.operation.lock().await;
    manager.initialize().await?;
    let api_key = provision_gateway_key(&manager, false).await?;
    let server_url = manager
        .state
        .lock()
        .await
        .grant
        .as_ref()
        .map(|grant| grant.server_url.clone())
        .ok_or_else(|| AuthError::new("UNAUTHORIZED"))?;
    Ok(GatewayCredentials {
        base_url: gateway_base_url(&server_url),
        api_key,
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAppStatus {
    pub installed: bool,
    pub name: Option<String>,
}

/// Detect the Codex desktop app without writing credentials or starting it.
#[tauri::command]
pub async fn cmd_sub2api_codex_app_status(window: WebviewWindow) -> Result<CodexAppStatus> {
    require_main(&window)?;
    let name = tokio::task::spawn_blocking(codex_launch::installed_app_name)
        .await
        .map_err(|_| AuthError::new("LAUNCH_FAILED"))?;
    Ok(CodexAppStatus {
        installed: name.is_some(),
        name,
    })
}

/// Open the Codex desktop app as a separate instance wired to the gateway.
/// Returns `true` when the instance was already running.
#[tauri::command]
pub async fn cmd_sub2api_launch_codex(
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
) -> Result<bool> {
    require_main(&window)?;
    let (base_url, api_key) = {
        let _operation = manager.operation.lock().await;
        manager.initialize().await?;
        let api_key = provision_gateway_key(&manager, false).await?;
        let server_url = manager
            .state
            .lock()
            .await
            .grant
            .as_ref()
            .map(|grant| grant.server_url.clone())
            .ok_or_else(|| AuthError::new("UNAUTHORIZED"))?;
        (gateway_base_url(&server_url), api_key)
    };
    let outcome = tokio::task::spawn_blocking(move || codex_launch::launch(&base_url, &api_key))
        .await
        .map_err(|_| AuthError::new("LAUNCH_FAILED"))??;
    Ok(matches!(
        outcome,
        codex_launch::LaunchOutcome::AlreadyRunning
    ))
}

#[tauri::command]
pub async fn cmd_sub2api_send_code(
    app: AppHandle,
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
    email: String,
) -> Result<u64> {
    require_main(&window)?;
    if !email.contains('@') || email.len() > 320 {
        return Err(AuthError::new("INVALID_INPUT"));
    }
    let _operation = manager.operation.lock().await;
    manager.initialize().await?;
    let server = manager.state.lock().await.server_url.clone();
    let settings = settings(&server).await?;
    if !settings.registration_enabled || !settings.email_verify_enabled {
        return Err(AuthError::new("REGISTRATION_DISABLED"));
    }
    let proof = captcha::proof(&app, &manager.captcha, &server, &settings).await?;
    let response = request(
        &server,
        "auth/send-verify-code",
        Some(json!({"email": email.trim(), "turnstile_token": proof})),
        None,
    )
    .await?;
    Ok(response
        .get("countdown")
        .and_then(Value::as_u64)
        .unwrap_or(60)
        .clamp(1, 600))
}

#[tauri::command]
pub async fn cmd_sub2api_logout(
    app: AppHandle,
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
) -> Result<AccountSnapshot> {
    require_main(&window)?;
    let _operation = manager.operation.lock().await;
    manager.initialize().await?;
    let grant = manager.state.lock().await.grant.clone();
    // Local logout works even offline. Clear secrets before best-effort remote revoke.
    save_grant(None).await?;
    manager.state.lock().await.grant = None;
    notify(&app);
    if let Some(grant) = grant {
        if !grant.refresh_token.is_empty() {
            let _ = request(
                &grant.server_url,
                "auth/logout",
                Some(json!({"refresh_token": grant.refresh_token})),
                None,
            )
            .await;
        }
    }
    Ok(manager.snapshot().await)
}

#[tauri::command]
pub async fn cmd_sub2api_cancel(
    window: WebviewWindow,
    manager: State<'_, Sub2apiAccount>,
) -> Result<()> {
    require_main(&window)?;
    manager.captcha.cancel().await;
    Ok(())
}

pub fn captcha_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("sub2api-captcha")
        .invoke_handler(tauri::generate_handler![captcha::complete])
        .build()
}

#[cfg(test)]
mod tests;
