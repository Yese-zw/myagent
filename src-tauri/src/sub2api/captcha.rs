//! The account form stays native. If the service requires Turnstile, display
//! only its verification widget in an isolated same-origin WebView. Never load
//! the provider's login page, expose passwords, or relax the main WebView ACL.
use super::{AuthError, PublicSettings, Result};
use serde_json::json;
use std::time::Duration;
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tokio::sync::{oneshot, Mutex};

struct Pending {
    label: String,
    nonce: String,
    url: String,
    sender: oneshot::Sender<Result<String>>,
}

#[derive(Default)]
pub(super) struct CaptchaState(Mutex<Option<Pending>>);

impl CaptchaState {
    pub async fn cancel(&self) {
        if let Some(pending) = self.0.lock().await.take() {
            let _ = pending.sender.send(Err(AuthError::new("CANCELLED")));
        }
    }
}

pub(super) async fn proof(
    app: &AppHandle,
    state: &CaptchaState,
    server: &str,
    settings: &PublicSettings,
) -> Result<String> {
    if settings.tencent_captcha_enabled || settings.aliyun_captcha_enabled {
        return Err(AuthError::new("CAPTCHA_UNSUPPORTED"));
    }
    if !settings.turnstile_enabled {
        return Ok(String::new());
    }
    if settings.turnstile_site_key.is_empty() || settings.turnstile_site_key.len() > 1024 {
        return Err(AuthError::new("INVALID_RESPONSE"));
    }
    let label = format!("sub2api-captcha-{}", uuid::Uuid::new_v4());
    let nonce = uuid::Uuid::new_v4().to_string();
    // A public JSON endpoint has the provider's real HTTPS origin (required by
    // Turnstile hostname validation), and contains no provider application JS.
    let url = format!("{server}/api/v1/settings/public");
    let parsed = url::Url::parse(&url).map_err(|_| AuthError::new("INVALID_SERVER"))?;
    let (sender, receiver) = oneshot::channel();
    *state.0.lock().await = Some(Pending {
        label: label.clone(),
        nonce: nonce.clone(),
        url: url.clone(),
        sender,
    });
    let capability = json!({
        "identifier": label, "local": false, "windows": [label],
        "remote": {"urls": [url]},
        "permissions": ["sub2api-captcha:allow-complete"],
    });
    if app.add_capability(capability.to_string()).is_err() {
        state.cancel().await;
        return Err(AuthError::new("CAPTCHA_UNAVAILABLE"));
    }
    let script = include_str!("captcha.js")
        .replace("__SERVER_JSON__", &json!(server).to_string())
        .replace("__NONCE_JSON__", &json!(nonce).to_string())
        .replace(
            "__SITE_KEY_JSON__",
            &json!(settings.turnstile_site_key).to_string(),
        );
    let allowed_url = url.clone();
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .scroll_bar_style(crate::webview_policy::scroll_bar_style())
        .title("安全验证 · Verification")
        .inner_size(400.0, 220.0)
        .resizable(false)
        .incognito(true)
        .initialization_script(script)
        .on_navigation(move |target| {
            target.as_str() == allowed_url
                || target.origin().ascii_serialization() == "https://challenges.cloudflare.com"
        })
        .build();
    let window = match window {
        Ok(window) => window,
        Err(_) => {
            state.cancel().await;
            return Err(AuthError::new("CAPTCHA_UNAVAILABLE"));
        }
    };
    let handle = app.clone();
    let closed_label = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let handle = handle.clone();
            let label = closed_label.clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<super::Sub2apiAccount>();
                let mut pending = state.captcha.0.lock().await;
                if pending.as_ref().is_some_and(|value| value.label == label) {
                    if let Some(pending) = pending.take() {
                        let _ = pending.sender.send(Err(AuthError::new("CANCELLED")));
                    }
                }
            });
        }
    });
    let result = match tokio::time::timeout(Duration::from_secs(180), receiver).await {
        Ok(Ok(result)) => result,
        _ => Err(AuthError::new("CAPTCHA_UNAVAILABLE")),
    };
    state.cancel().await;
    let _ = window.close();
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    result
}

#[tauri::command]
pub(super) async fn complete(
    window: WebviewWindow,
    state: State<'_, super::Sub2apiAccount>,
    nonce: String,
    token: String,
) -> Result<()> {
    let mut slot = state.captcha.0.lock().await;
    let pending = slot.as_ref().ok_or_else(|| AuthError::new("NOT_ALLOWED"))?;
    let url = window.url().map_err(|_| AuthError::new("NOT_ALLOWED"))?;
    if pending.label != window.label()
        || pending.nonce != nonce
        || pending.url != url.as_str()
        || token.len() > 16_384
    {
        return Err(AuthError::new("NOT_ALLOWED"));
    }
    if let Some(pending) = slot.take() {
        let result = if token.is_empty() {
            Err(AuthError::new("CAPTCHA_UNAVAILABLE"))
        } else {
            Ok(token)
        };
        let _ = pending.sender.send(result);
    }
    Ok(())
}
