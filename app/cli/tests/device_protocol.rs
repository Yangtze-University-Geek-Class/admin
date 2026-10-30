use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Default)]
struct State {
    polls: usize,
    decision: String,
    revoked: bool,
    revoke_failure: bool,
    requests: Vec<(String, String, String)>,
}

struct Fixture {
    origin: String,
    home: PathBuf,
    state: Arc<Mutex<State>>,
    stop: Arc<std::sync::atomic::AtomicBool>,
    server: Option<thread::JoinHandle<()>>,
}

impl Fixture {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let home = std::env::temp_dir().join(format!(
            "geek-device-{}-{}",
            std::process::id(),
            address.port()
        ));
        std::fs::create_dir(&home).unwrap();
        let state = Arc::new(Mutex::new(State::default()));
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let state_thread = state.clone();
        let stop_thread = stop.clone();
        let origin = format!("http://{address}");
        let server_origin = origin.clone();
        let server = thread::spawn(move || {
            for stream in listener.incoming() {
                if stop_thread.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                serve(stream.unwrap(), &server_origin, &state_thread);
            }
        });
        Self {
            origin,
            home,
            state,
            stop,
            server: Some(server),
        }
    }

    fn command(&self, args: &[&str], token: Option<&str>) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_geek"));
        cmd.args(args)
            .env_clear()
            .env("HOME", &self.home)
            .env("USERPROFILE", &self.home)
            .env("XDG_CONFIG_HOME", self.home.join(".config"))
            .env("GEEK_NO_KEYRING", "1")
            .env("GEEK_ORIGIN", &self.origin)
            .env("NO_COLOR", "1")
            .current_dir(&self.home);
        if let Some(token) = token {
            cmd.env("GEEK_TOKEN", token);
        }
        cmd
    }

    fn run(&self, args: &[&str], token: Option<&str>) -> Output {
        self.command(args, token).output().unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = TcpStream::connect(self.origin.trim_start_matches("http://"));
        self.server.take().unwrap().join().unwrap();
        std::fs::remove_dir_all(&self.home).unwrap();
    }
}

fn serve(mut stream: TcpStream, origin: &str, state: &Mutex<State>) {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    let header_end = loop {
        let size = stream.read(&mut buffer).unwrap();
        assert_ne!(size, 0);
        bytes.extend_from_slice(&buffer[..size]);
        if let Some(index) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let headers = String::from_utf8(bytes[..header_end].to_vec())
        .unwrap()
        .to_lowercase();
    let length: usize = headers
        .lines()
        .find_map(|line| line.strip_prefix("content-length: "))
        .unwrap_or("0")
        .parse()
        .unwrap();
    while bytes.len() < header_end + length {
        let size = stream.read(&mut buffer).unwrap();
        assert_ne!(size, 0);
        bytes.extend_from_slice(&buffer[..size]);
    }
    let first = headers.lines().next().unwrap();
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap();
    let path = parts.next().unwrap();
    let body = String::from_utf8(bytes[header_end..].to_vec()).unwrap();
    let auth = headers
        .lines()
        .find_map(|line| line.strip_prefix("authorization: "))
        .unwrap_or("");
    let mut state = state.lock().unwrap();
    state
        .requests
        .push((path.into(), auth.into(), body.clone()));
    let (status, value) = match (method, path) {
        ("post", "/auth/device/code") => {
            let form: Vec<_> = url::form_urlencoded::parse(body.as_bytes())
                .into_owned()
                .collect();
            assert!(form.contains(&("client_id".into(), "geek-cli".into())));
            assert!(form.contains(&(
                "scope".into(),
                "openid profile forum apply competition repo".into()
            )));
            (
                200,
                json!({
                    "device_code": "synthetic_device_code", "user_code": "BCDF-GHJK",
                    "verification_uri": format!("{origin}/device"),
                    "verification_uri_complete": format!("{origin}/device?user_code=BCDF-GHJK"),
                    "expires_in": if state.decision == "timeout" { 0 } else { 10 }, "interval": 1
                }),
            )
        }
        ("post", "/auth/device/token") => {
            let form: Vec<_> = url::form_urlencoded::parse(body.as_bytes())
                .into_owned()
                .collect();
            assert!(form.contains(&(
                "grant_type".into(),
                "urn:ietf:params:oauth:grant-type:device_code".into()
            )));
            assert!(form.contains(&("device_code".into(), "synthetic_device_code".into())));
            assert!(form.contains(&("client_id".into(), "geek-cli".into())));
            state.polls += 1;
            match state.decision.as_str() {
                "denied" => (400, json!({"error":"access_denied"})),
                "expired" => (400, json!({"error":"expired_token"})),
                _ if state.polls == 1 => (400, json!({"error":"authorization_pending"})),
                _ => (
                    200,
                    json!({"access_token":"gk_fixture","scope":"openid profile forum apply competition repo","account_id":"fixture-account"}),
                ),
            }
        }
        ("get", "/auth/device/userinfo") if state.revoked || auth != "bearer gk_fixture" => {
            (401, json!({"error":"invalid_token","message":"令牌无效"}))
        }
        ("get", "/auth/device/userinfo") => (
            200,
            json!({
                "account_id":"fixture-account","sub":"fixture-account","login":"fixture-user",
                "display_name":"统一昵称","username":"fixture-user","bio":"公开签名",
                "avatar_url":"/avatar.png","scope":"openid profile","grade_label":"大二",
                "email_required":false,"profile_required":false
            }),
        ),
        ("get", "/api/console/me") => (
            200,
            json!({
                "account_id":"fixture-account","login":"fixture-user","display_name":"统一昵称",
                "avatar_url":format!("{origin}/avatar.png"),"department":{"name":"技术部"},
                "real_name":"PRIVATE_FIXTURE_NAME","email":"private@example.test"
            }),
        ),
        ("post", "/auth/device/revoke") if state.revoke_failure => (
            503,
            json!({"error":"temporarily_unavailable","message":"稍后重试"}),
        ),
        ("post", "/auth/device/revoke") => {
            state.revoked = true;
            (200, json!({"ok":true}))
        }
        ("get", "/healthz") => (200, json!({"ok":true})),
        ("get", "/avatar.png") => (200, json!({"not":"an image"})),
        _ => (404, json!({"error":"not_found"})),
    };
    let body = value.to_string();
    write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
}

fn result(output: Output, code: i32) -> Value {
    assert_eq!(
        output.status.code(),
        Some(code),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], code == 0);
    assert!(!String::from_utf8_lossy(&output.stdout).contains("PRIVATE_FIXTURE"));
    value
}

#[test]
fn pending_login_profile_revoke_and_missing_token_follow_the_http_protocol() {
    let fixture = Fixture::new();
    let login = result(fixture.run(&["login", "--no-browser", "--json"], None), 0);
    assert_eq!(login["data"]["account_id"], "fixture-account");
    assert_eq!(login["data"]["nickname"], "统一昵称");
    assert_eq!(fixture.state.lock().unwrap().polls, 2);
    let whoami = result(fixture.run(&["whoami", "--json"], None), 0);
    assert_eq!(whoami["data"]["nickname"], "统一昵称");
    assert_eq!(whoami["data"]["avatar_url"], "/avatar.png");
    result(fixture.run(&["status", "--json"], None), 0);
    result(fixture.run(&["logout", "--json"], None), 0);
    assert!(fixture.state.lock().unwrap().revoked);
    assert_eq!(
        result(fixture.run(&["whoami", "--json"], Some("gk_fixture")), 3)["error"]["code"],
        "invalid_token"
    );
    assert_eq!(
        result(fixture.run(&["whoami", "--json"], None), 3)["error"]["code"],
        "not_signed_in"
    );
    let state = fixture.state.lock().unwrap();
    assert!(state
        .requests
        .iter()
        .filter(|(path, _, _)| path == "/healthz" || path == "/avatar.png")
        .all(|(_, auth, _)| auth.is_empty()));
}

#[test]
fn denied_expired_and_local_timeout_do_not_store_a_token() {
    for (decision, error) in [
        ("denied", "access_denied"),
        ("expired", "expired_token"),
        ("timeout", "expired_token"),
    ] {
        let fixture = Fixture::new();
        fixture.state.lock().unwrap().decision = decision.into();
        assert_eq!(
            result(fixture.run(&["login", "--no-browser", "--json"], None), 1)["error"]["code"],
            error
        );
        assert_eq!(
            result(fixture.run(&["whoami", "--json"], None), 3)["error"]["code"],
            "not_signed_in"
        );
    }
}

#[test]
fn failed_revoke_is_not_reported_as_a_successful_logout() {
    let fixture = Fixture::new();
    result(fixture.run(&["login", "--no-browser", "--json"], None), 0);
    fixture.state.lock().unwrap().revoke_failure = true;
    assert_eq!(
        result(fixture.run(&["logout", "--json"], None), 1)["error"]["code"],
        "temporarily_unavailable"
    );
    assert!(!fixture.state.lock().unwrap().revoked);
    result(fixture.run(&["whoami", "--json"], None), 0);
}

#[test]
fn non_tty_login_still_shows_the_verification_code_without_escape_sequences() {
    let fixture = Fixture::new();
    let output = fixture.run(&["login", "--no-browser"], None);
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("BCDF-GHJK"), "{stdout}");
    assert!(stdout.contains(&format!("{}/device", fixture.origin)));
    assert!(!stdout.contains('\x1b'));
}
