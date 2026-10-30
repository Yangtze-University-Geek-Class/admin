use serde_json::Value;
use std::process::Command;

#[test]
fn missing_tokens_and_failed_revocation_have_honest_exit_codes() {
    let home = std::env::temp_dir().join(format!("geek-offline-auth-{}", std::process::id()));
    std::fs::create_dir(&home).unwrap();
    let run = |command: &str, token: Option<&str>| {
        let mut cli = Command::new(env!("CARGO_BIN_EXE_geek"));
        cli.args([command, "--json"])
            .env_clear()
            .env("HOME", &home)
            .env("USERPROFILE", &home)
            .env("XDG_CONFIG_HOME", home.join(".config"))
            .env("GEEK_NO_KEYRING", "1")
            .env("GEEK_ORIGIN", "http://127.0.0.1:9");
        if let Some(token) = token {
            cli.env("GEEK_TOKEN", token);
        }
        let output = cli.output().unwrap();
        assert!(output.stderr.is_empty());
        let json: Value = serde_json::from_slice(&output.stdout).unwrap();
        (output.status.code(), json)
    };
    let (code, missing) = run("whoami", None);
    assert_eq!(code, Some(3));
    assert_eq!(missing["error"]["code"], "not_signed_in");
    let (code, status) = run("status", None);
    assert_eq!(code, Some(0));
    assert_eq!(status["data"]["signed_in"], false);
    assert_eq!(status["data"]["token_valid"], false);
    let (code, revoke) = run("logout", Some("gk_offline"));
    assert_eq!(code, Some(6));
    assert_eq!(revoke["ok"], false);
    assert_eq!(revoke["error"]["code"], "network_error");
    let (code, status) = run("status", Some("gk_offline"));
    assert_eq!(code, Some(0));
    assert_eq!(status["data"]["token_source"], "GEEK_TOKEN 环境变量");
    assert_eq!(status["data"]["signed_in"], true);
    assert_eq!(status["data"]["token_valid"], false);
    assert!(!status.to_string().contains("gk_offline"));
    std::fs::remove_dir_all(home).unwrap();
}
