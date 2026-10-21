use super::*;
use std::io::{Read, Write};

#[tokio::test]
#[ignore = "read-only live service check; set SUB2API_TEST_ORIGIN explicitly"]
async fn configured_service_public_settings_are_compatible() {
    let origin = std::env::var("SUB2API_TEST_ORIGIN").expect("SUB2API_TEST_ORIGIN");
    let value = request(&origin, "settings/public", None, None)
        .await
        .unwrap();
    let parsed = serde_json::from_value::<PublicSettings>(value);
    assert!(
        parsed.is_ok(),
        "public settings schema: {}",
        parsed.err().unwrap()
    );
}

#[tokio::test]
async fn public_settings_allow_embedded_branding_but_auth_responses_stay_bounded() {
    let payload = json!({"code":0,"data":{"site_name":"Service", "site_logo":"x".repeat(RESPONSE_LIMIT + 1)}});
    let (server, _) = fixture("200 OK", payload.clone(), None);
    assert_eq!(settings(&server).await.unwrap().site_name, "Service");
    let (server, _) = fixture("200 OK", payload, None);
    assert_eq!(
        request(&server, "auth/me", None, None)
            .await
            .unwrap_err()
            .code,
        "INVALID_RESPONSE"
    );
}

#[test]
fn packaged_defaults_pin_origin_and_key_group() {
    let defaults = packaged_defaults().unwrap();
    assert_eq!(defaults.server_url, "https://lingsiai.vip");
    assert_eq!(defaults.default_group_id, 110);
}

#[test]
fn gateway_base_url_follows_the_packaged_origin() {
    assert_eq!(gateway_base_url("https://lingsiai.vip"), "https://lingsiai.vip/v1");
    assert_eq!(
        extract_gateway_key(&json!({"key":"sk-live-example","name":"MyAgents"})).as_deref(),
        Some("sk-live-example")
    );
    assert_eq!(
        extract_gateway_key(&json!({"data":{"api_key":"sk-nested-secret"}})).as_deref(),
        Some("sk-nested-secret")
    );
    assert!(!account_has_keys(&json!({"items":[]})));
    assert!(account_has_keys(&json!({"items":[{"id":1,"name":"MyAgents"}]})));
}

#[test]
fn create_key_always_uses_the_packaged_group() {
    let (path, method, payload) = account_api_request(
        "create-key",
        Some(json!({"name":"MyAgents","group_id":1,"extra":true})),
    )
    .unwrap();
    assert_eq!(path, "keys");
    assert_eq!(method, reqwest::Method::POST);
    assert_eq!(payload, Some(json!({"name":"MyAgents","group_id":110})));
    assert!(account_api_request("create-key", Some(json!({"name":""}))).is_err());
}

#[test]
fn account_origins_never_contain_credentials_or_api_paths() {
    assert_eq!(
        normalize_server_url(" https://EXAMPLE.com:8443/ ").unwrap(),
        "https://example.com:8443"
    );
    assert_eq!(
        normalize_server_url("http://127.0.0.1:8080").unwrap(),
        "http://127.0.0.1:8080"
    );
    for value in [
        "http://example.com",
        "https://user:password@example.com",
        "https://example.com/api/v1",
        "https://example.com/?key=secret",
        "https://example.com/#token",
        "file:///tmp/server",
        "javascript:alert(1)",
    ] {
        assert!(normalize_server_url(value).is_err(), "{value}");
    }
}

#[test]
fn public_account_projection_excludes_all_credentials() {
    let user = AccountUser {
        id: 7,
        email: "a@example.com".into(),
        username: "Alice".into(),
    };
    let grant = Grant {
        server_url: "https://example.com".into(),
        access_token: "private-access".into(),
        refresh_token: "private-refresh".into(),
        user: user.clone(),
        api_key: String::new(),
    };
    let value = serde_json::to_string(&AccountSnapshot {
        server_url: grant.server_url.clone(),
        user: Some(user),
    })
    .unwrap();
    assert!(!value.contains("private-access"));
    assert!(!value.contains("private-refresh"));
    assert!(!value.contains("token"));
    assert_eq!(user_from_response(json!({"id":7,"email":"a@example.com","username":"Alice","balance":10,"access_token":"unexpected"})).unwrap().id, 7);
    assert!(user_from_response(json!({"id":0,"email":"a@example.com"})).is_err());
}

fn fixture(
    status: &str,
    value: Value,
    redirect: Option<&str>,
) -> (String, std::sync::mpsc::Receiver<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let body = value.to_string();
    let headers = redirect
        .map(|url| format!("Location: {url}\r\n"))
        .unwrap_or_default();
    let response = format!("HTTP/1.1 {status}\r\n{headers}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = [0_u8; 8192];
        let length = stream.read(&mut bytes).unwrap();
        let _ = sender.send(String::from_utf8_lossy(&bytes[..length]).to_string());
        stream.write_all(response.as_bytes()).unwrap();
    });
    (origin, receiver)
}

#[tokio::test]
async fn native_account_api_unwraps_sub2api_and_sends_bearer_only_as_header() {
    let (server, received) = fixture(
        "200 OK",
        json!({"code":0,"data":{"id":7,"email":"a@example.com"}}),
        None,
    );
    let data = request(&server, "auth/me", None, Some("test-secret"))
        .await
        .unwrap();
    assert_eq!(data["id"], 7);
    let sent = received.recv().unwrap().to_ascii_lowercase();
    assert!(sent.starts_with("get /api/v1/auth/me http/1.1"));
    assert!(sent.contains("authorization: bearer test-secret"));
    assert!(!sent.lines().next().unwrap().contains("test-secret"));
}

#[tokio::test]
async fn account_api_does_not_follow_redirects_with_credentials() {
    let (server, _) = fixture(
        "302 Found",
        json!({"code":1}),
        Some("http://127.0.0.1:1/steal"),
    );
    let error = request(&server, "auth/me", None, Some("private-bearer"))
        .await
        .unwrap_err();
    assert_eq!(error.code, "SERVER_ERROR");
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains("private-bearer"));
}

#[tokio::test]
async fn http_status_and_business_failures_are_not_mistaken_for_login_success() {
    let (server, _) = fixture(
        "401 Unauthorized",
        json!({"code":401,"message":"echo password=secret https://private.example"}),
        None,
    );
    let error = request(
        &server,
        "auth/login",
        Some(json!({"email":"a@example.com","password":"test-password"})),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "UNAUTHORIZED");
    assert!(!serde_json::to_string(&error).unwrap().contains("secret"));
    let (server, _) = fixture(
        "200 OK",
        json!({"code":400,"message":"not successful"}),
        None,
    );
    assert!(request(&server, "auth/login", Some(json!({})), None)
        .await
        .is_err());
}

#[test]
fn account_api_maps_profile_password_and_notify_email_operations() {
    let (path, method, payload) = account_api_request(
        "change-password",
        Some(json!({"old_password":"old-pass","new_password":"new-pass-1","extra":true})),
    )
    .unwrap();
    assert_eq!(path, "user/password");
    assert_eq!(method, reqwest::Method::PUT);
    assert_eq!(
        payload,
        Some(json!({"old_password":"old-pass","new_password":"new-pass-1"}))
    );
    assert!(account_api_request(
        "change-password",
        Some(json!({"old_password":"old","new_password":"short"}))
    )
    .is_err());
    let (path, method, payload) = account_api_request(
        "send-notify-email-code",
        Some(json!({"email":"alert@example.test","note":"drop"})),
    )
    .unwrap();
    assert_eq!(path, "user/notify-email/send-code");
    assert_eq!(method, reqwest::Method::POST);
    assert_eq!(payload, Some(json!({"email":"alert@example.test"})));
    let (path, method, _) = account_api_request(
        "remove-notify-email",
        Some(json!({"email":"alert@example.test"})),
    )
    .unwrap();
    assert_eq!(path, "user/notify-email");
    assert_eq!(method, reqwest::Method::DELETE);
    let (path, method, payload) = account_api_request(
        "dashboard-trend",
        Some(json!({"start_date":"2026-10-14","end_date":"2026-10-21","granularity":"day","timezone":"Asia/Shanghai"})),
    )
    .unwrap();
    assert_eq!(path, "usage/dashboard/trend?start_date=2026-10-14&end_date=2026-10-21&granularity=day&timezone=Asia%2FShanghai");
    assert_eq!(method, reqwest::Method::GET);
    assert_eq!(payload, None);
    assert_eq!(
        account_api_request("dashboard-stats", None).unwrap().0,
        "usage/dashboard/stats"
    );
    assert_eq!(
        account_api_request("dashboard-models", None).unwrap().0,
        "usage/dashboard/models"
    );
}

#[test]
fn captcha_is_a_single_command_capability_without_login_credentials() {
    let script = include_str!("captcha.js");
    assert!(script.contains("plugin:sub2api-captcha|complete"));
    assert!(!script.contains("localStorage"));
    assert!(!script.contains("password"));
    assert!(!script.contains("/auth/login"));
}
