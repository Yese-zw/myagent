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
    let loaded = settings(&server).await.unwrap();
    assert_eq!(loaded.site_name, "Service");
    assert_eq!(loaded.site_logo.len(), RESPONSE_LIMIT + 1);
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
fn packaged_defaults_pin_only_the_origin() {
    let defaults = packaged_defaults().unwrap();
    assert_eq!(defaults.server_url, "https://api.lingsiai.cn");
}

#[test]
fn app_group_prefers_the_user_choice_then_the_server_default() {
    assert_eq!(effective_app_group_id(7, 110).unwrap(), 7);
    assert_eq!(effective_app_group_id(0, 110).unwrap(), 110);
    assert_eq!(
        effective_app_group_id(0, 0).unwrap_err().code,
        "APP_NOT_CONFIGURED"
    );
}

#[test]
fn public_settings_carry_the_app_config() {
    let settings: PublicSettings = serde_json::from_value(json!({
        "site_name": "Gateway",
        "app_name": "Example Agent",
        "app_default_group_id": 110
    }))
    .unwrap();
    assert_eq!(settings.app_name, "Example Agent");
    assert_eq!(settings.app_default_group_id, 110);

    let legacy: PublicSettings = serde_json::from_value(json!({"site_name": "Gateway"})).unwrap();
    assert_eq!(legacy.app_name, "");
    assert_eq!(legacy.app_default_group_id, 0);
    assert_eq!(legacy.community_group_image, "");
}

#[test]
fn gateway_base_url_follows_the_packaged_origin() {
    assert_eq!(
        gateway_base_url("https://api.lingsiai.cn"),
        "https://api.lingsiai.cn/v1"
    );
    assert_eq!(
        extract_gateway_key(&json!({"key":"sk-live-example","name":"LSAGENT"})).as_deref(),
        Some("sk-live-example")
    );
    assert_eq!(
        extract_gateway_key(&json!({"data":{"api_key":"sk-nested-secret"}})).as_deref(),
        Some("sk-nested-secret")
    );
    assert!(!account_has_keys(&json!({"items":[]})));
    assert!(account_has_keys(
        &json!({"items":[{"id":1,"name":"LSAGENT"}]})
    ));
}

#[test]
fn registration_group_key_requires_the_app_group() {
    let group_id = 110;
    let other_groups = json!({
        "items": [
            {"id": 1, "name": "manual", "group_id": 1, "key": "sk-other-secret"},
            {"id": 2, "name": "nested", "group": {"id": 7}, "key": "sk-nested-other"}
        ]
    });
    assert!(find_registration_group_key(key_items(&other_groups), group_id).is_none());

    let listed = json!({
        "data": {
            "items": [
                {"id": 2, "name": "manual", "group_id": "7", "key": "sk-other-secret"},
                {"id": 3, "name": "LSAGENT", "group_id": group_id, "key": "sk-group-secret"}
            ]
        }
    });
    let found = find_registration_group_key(key_items(&listed), group_id).unwrap();
    assert_eq!(found["id"], 3);
    assert_eq!(listed_key_secret(found).as_deref(), Some("sk-group-secret"));

    let nested_group = json!({"id": 4, "group": {"id": group_id}, "key": "sk-nested-group"});
    assert_eq!(key_group_id(&nested_group), Some(group_id));
    assert_eq!(
        listed_key_secret(&json!({"group_id": group_id, "key": "sk-****cret"})),
        None
    );
    assert_eq!(key_group_id(&json!({"group_id": "110"})), Some(110));
    assert_eq!(key_group_id(&json!({"group_id": null})), None);
}

#[test]
fn create_key_drops_a_renderer_chosen_group() {
    let (path, method, payload) = account_api_request(
        "create-key",
        Some(json!({"name":"LSAGENT","group_id":1,"extra":true})),
    )
    .unwrap();
    assert_eq!(path, "keys");
    assert_eq!(method, reqwest::Method::POST);
    // `authenticated_api` inserts the server-resolved App group afterwards.
    assert_eq!(payload, Some(json!({"name":"LSAGENT"})));
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
        app_group_id: 0,
    };
    let value = serde_json::to_string(&AccountSnapshot {
        server_url: grant.server_url.clone(),
        user: Some(user),
        app_group_id: None,
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
fn account_api_maps_announcement_reads_without_extra_fields() {
    let (path, method, payload) = account_api_request("announcements", None).unwrap();
    assert_eq!(path, "announcements");
    assert_eq!(method, reqwest::Method::GET);
    assert_eq!(payload, None);
    let (path, method, payload) =
        account_api_request("announcement-read", Some(json!({"id": 12, "extra": true}))).unwrap();
    assert_eq!(path, "announcements/12/read");
    assert_eq!(method, reqwest::Method::POST);
    assert_eq!(payload, Some(json!({})));
    assert!(account_api_request("announcement-read", Some(json!({"id": 0}))).is_err());
    assert!(account_api_request("announcements", Some(json!({"page": 1}))).is_err());
}

#[test]
fn account_api_maps_balance_recharge_operations_with_a_closed_payload() {
    let (path, method, payload) = account_api_request("checkout-info", None).unwrap();
    assert_eq!(path, "payment/checkout-info");
    assert_eq!(method, reqwest::Method::GET);
    assert_eq!(payload, None);
    assert!(account_api_request("checkout-info", Some(json!({"page": 1}))).is_err());
    let (path, method, payload) = account_api_request(
        "create-order",
        Some(json!({"amount": 50, "payment_type": "alipay", "order_type": "subscription", "plan_id": 3, "return_url": "https://evil.test"})),
    )
    .unwrap();
    assert_eq!(path, "payment/orders");
    assert_eq!(method, reqwest::Method::POST);
    assert_eq!(
        payload,
        Some(
            json!({"amount": 50.0, "payment_type": "alipay", "order_type": "balance", "is_mobile": false, "payment_source": "hosted_redirect"})
        )
    );
    assert!(account_api_request(
        "create-order",
        Some(json!({"amount": 0, "payment_type": "alipay"}))
    )
    .is_err());
    assert!(account_api_request(
        "create-order",
        Some(json!({"amount": 10, "payment_type": "../x"}))
    )
    .is_err());
    let (path, method, payload) =
        account_api_request("get-order", Some(json!({"id": 9, "extra": true}))).unwrap();
    assert_eq!(path, "payment/orders/9");
    assert_eq!(method, reqwest::Method::GET);
    assert_eq!(payload, None);
    let (path, method, payload) = account_api_request(
        "verify-order",
        Some(json!({"out_trade_no": "T123", "extra": true})),
    )
    .unwrap();
    assert_eq!(path, "payment/orders/verify");
    assert_eq!(method, reqwest::Method::POST);
    assert_eq!(payload, Some(json!({"out_trade_no": "T123"})));
    assert!(account_api_request("verify-order", Some(json!({"out_trade_no": ""}))).is_err());
}

#[test]
fn account_api_maps_affiliate_reads_and_transfers_without_extra_fields() {
    let (path, method, payload) = account_api_request("affiliate", None).unwrap();
    assert_eq!(path, "user/aff");
    assert_eq!(method, reqwest::Method::GET);
    assert_eq!(payload, None);
    assert!(account_api_request("affiliate", Some(json!({"page": 1}))).is_err());
    let (path, method, payload) = account_api_request("affiliate-transfer", None).unwrap();
    assert_eq!(path, "user/aff/transfer");
    assert_eq!(method, reqwest::Method::POST);
    assert_eq!(payload, Some(json!({})));
    assert!(account_api_request("affiliate-transfer", Some(json!({"amount": 1}))).is_err());
}

#[test]
fn captcha_is_a_single_command_capability_without_login_credentials() {
    let script = include_str!("captcha.js");
    assert!(script.contains("plugin:sub2api-captcha|complete"));
    assert!(!script.contains("localStorage"));
    assert!(!script.contains("password"));
    assert!(!script.contains("/auth/login"));
}

#[test]
fn codex_launch_config_replaces_only_gateway_owned_top_level_keys() {
    let existing = "model = \"gpt-5\"\nopenai_base_url = \"https://old.example/v1\"\nmodel_provider = \"custom\"\nforced_login_method = \"chatgpt\"\ncli_auth_credentials_store = \"keyring\"\n\n[model_providers.custom]\nbase_url = \"https://keep.example\"\n";
    let merged =
        super::codex_launch::merge_config(existing, "https://gw.example/v1", "Example Site");
    assert!(merged.starts_with("openai_base_url = \"https://gw.example/v1\"\n"));
    assert!(merged.contains("cli_auth_credentials_store = \"file\""));
    assert!(merged.contains("forced_login_method = \"api\""));
    assert!(merged.contains("model = \"gpt-5\""));
    assert!(!merged.contains("old.example"));
    assert!(!merged.contains("chatgpt"));
    assert!(!merged.contains("keyring"));
    assert!(!merged.contains("model_provider = "));
    assert!(merged.contains("[model_providers.custom]\nbase_url = \"https://keep.example\""));
    assert!(merged.contains("[model_providers.openai]"));
    assert!(merged.contains("name = \"Example Site\""));

    let unlocked =
        super::codex_launch::merge_config("model = \"gpt-5\"\n", "https://gw.example/v1", "Site");
    assert!(!unlocked.contains("forced_login_method"));
    assert!(unlocked.contains("cli_auth_credentials_store = \"file\""));
}

#[test]
fn codex_launch_provider_name_matches_site_and_keeps_openai_history() {
    assert_eq!(
        super::codex_launch::provider_display_name("  灵矽 AI  ", "https://api.lingsiai.cn/v1"),
        "灵矽 AI"
    );
    assert_eq!(
        super::codex_launch::provider_display_name("", "https://www.api.lingsiai.cn/v1"),
        "api.lingsiai.cn"
    );

    let existing = "[desktop]\ntheme = \"dark\"\n\n[model_providers.openai]\nname = \"Old\"\nbase_url = \"https://lingsiai.vip/v1\"\nwire_api = \"responses\"\n\n[model_providers.custom]\nname = \"Keep Me\"\n";
    let merged =
        super::codex_launch::merge_config(existing, "https://api.lingsiai.cn/v1", "灵矽 AI");
    assert_eq!(merged.matches("[model_providers.openai]").count(), 1);
    assert!(merged.contains("name = \"灵矽 AI\""));
    assert!(merged.contains("base_url = \"https://api.lingsiai.cn/v1\""));
    assert!(!merged.contains("lingsiai.vip"));
    assert!(merged.contains("[desktop]\ntheme = \"dark\""));
    assert!(merged.contains("[model_providers.custom]\nname = \"Keep Me\""));
    assert!(!merged.contains("model_provider = "));
}

#[test]
fn codex_launch_opens_a_separate_app_instance_on_the_gateway_profile() {
    use std::path::Path;
    let args = super::codex_launch::open_args(
        Path::new("/Applications/ChatGPT.app"),
        Path::new("/Users/me/.myagents/codex-gateway"),
        Path::new("/Users/me/.myagents/codex-gateway-app-data"),
    );
    assert_eq!(
        args,
        [
            "-n",
            "--env",
            "CODEX_HOME=/Users/me/.myagents/codex-gateway",
            "--env",
            "CODEX_ELECTRON_USER_DATA_PATH=/Users/me/.myagents/codex-gateway-app-data",
            "-a",
            "/Applications/ChatGPT.app",
            "--args",
            "--user-data-dir=/Users/me/.myagents/codex-gateway-app-data",
        ]
    );
    // The key travels only through the owner-only auth.json, never argv.
    assert!(args.iter().all(|arg| !arg.contains("OPENAI_API_KEY")));
}

#[test]
fn account_api_maps_model_plaza_to_an_authenticated_get() {
    let (path, method, _) = account_api_request("model-plaza", None).unwrap();
    assert_eq!(path, "model-plaza");
    assert_eq!(method, reqwest::Method::GET);
}

#[cfg(unix)]
#[test]
fn share_history_links_sessions_and_migrates_local_rollouts() {
    let root = std::env::temp_dir().join(format!("codex-share-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (home, user) = (root.join("gateway"), root.join("user"));
    std::fs::create_dir_all(home.join("sessions/2026")).unwrap();
    std::fs::write(home.join("sessions/2026/local.jsonl"), "x").unwrap();
    std::fs::create_dir_all(user.join("sessions/2026")).unwrap();
    std::fs::write(user.join("sessions/2026/user.jsonl"), "y").unwrap();
    super::codex_launch::share_history(&home, &user);
    super::codex_launch::share_history(&home, &user);
    assert!(std::fs::symlink_metadata(home.join("sessions")).unwrap().file_type().is_symlink());
    assert!(home.join("sessions/2026/user.jsonl").is_file());
    assert!(user.join("sessions/2026/local.jsonl").is_file());
    let _ = std::fs::remove_dir_all(&root);
}
