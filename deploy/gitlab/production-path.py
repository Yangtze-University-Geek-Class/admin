#!/usr/bin/env python3
"""Move the production GitLab to <PUBLIC_ORIGIN>/gitlab (#335) without touching its data, image or network.

Renders docker-compose.yml from the repository template and the canonical production env, points the hand-merged
gitlab.rb lines (OIDC callback, avatar URLs) at the host file yzgc-gitlab-url, recreates the container and waits for
health. Any failure restores the three files and recreates the previous container. Only counts and digests are printed.
"""

import argparse
import fcntl
import hashlib
import ipaddress
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

CONTAINER = "gitlab"
# Failures that take the restore path: file I/O, failed or timed-out commands, mismatched configuration.
FAILURES = (OSError, RuntimeError, ValueError, subprocess.SubprocessError)
URL_FILE = "/etc/gitlab/yzgc-gitlab-url"
# gitlab.rb lines that used to carry the old host; each must exist exactly once, literal or already reading URL_FILE.
RB_LINES = {
    "redirect_uri": (
        re.compile(
            r"^(\s*)redirect_uri: (?:'[^'\n]*'|File\.read\('/etc/gitlab/yzgc-gitlab-url'\)\.strip \+ '[^'\n]*')([^\n]*)$",
            re.MULTILINE,
        ),
        "{0}redirect_uri: File.read('"
        + URL_FILE
        + "').strip + '/users/auth/openid_connect/callback'{1}",
    ),
    "gravatar_plain_url": (
        re.compile(r"^(\s*)gitlab_rails\['gravatar_plain_url'\] = .*$", re.MULTILINE),
        "{0}gitlab_rails['gravatar_plain_url'] = File.read('"
        + URL_FILE
        + "').strip + '/nano-avatar/20261025/%{{hash}}?s=%{{size}}'",
    ),
    "gravatar_ssl_url": (
        re.compile(r"^(\s*)gitlab_rails\['gravatar_ssl_url'\] = .*$", re.MULTILINE),
        "{0}gitlab_rails['gravatar_ssl_url'] = File.read('"
        + URL_FILE
        + "').strip + '/nano-avatar/20261025/%{{hash}}?s=%{{size}}'",
    ),
}


def read_config(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if not line or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise ValueError("invalid or duplicate environment field")
        values[key] = value
    if (
        values.get("GEEK_DEPLOYMENT_ENVIRONMENT") != "production"
        or values.get("GITLAB_STACK_ROOT") != "/srv/gitlab"
    ):
        raise ValueError("production target identity does not match")
    origin = urlsplit(values.get("PUBLIC_ORIGIN", ""))
    if (
        origin.scheme != "https"
        or origin.path
        or origin.query
        or origin.fragment
        or origin.username
        or origin.password
        or origin.port
    ):
        raise ValueError("invalid production origin")
    if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", origin.hostname or ""):
        raise ValueError("invalid production host")
    if values.get("GITLAB_URL") != values["PUBLIC_ORIGIN"] + "/gitlab":
        raise ValueError(
            "production GitLab must use the /gitlab base path of its origin"
        )
    binding = re.fullmatch(r"([0-9.]+):([0-9]+)", values.get("GITLAB_HTTP_BIND", ""))
    if (
        not binding
        or binding[1] != values.get("DEPLOY_HOST")
        or not ipaddress.ip_address(binding[1]).is_private
        or not 1024 <= int(binding[2]) <= 65535
    ):
        raise ValueError("invalid production GitLab binding")
    subnet = ipaddress.ip_network(values.get("GITLAB_DOCKER_SUBNET", ""), strict=True)
    gateway = ipaddress.ip_address(values.get("GITLAB_DOCKER_GATEWAY", ""))
    if not subnet.is_private or gateway != subnet.network_address + 1:
        raise ValueError("invalid production GitLab network")
    config = {
        key: values[key]
        for key in [
            "GITLAB_URL",
            "GITLAB_STACK_ROOT",
            "GITLAB_HTTP_BIND",
            "GITLAB_DOCKER_SUBNET",
            "GITLAB_DOCKER_GATEWAY",
        ]
    }
    config["GITLAB_HTTP_PORT"] = binding[2]
    return config


def checked_path(root, relative):
    path = root / relative
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError("symlink target refused")
        if parent == root:
            break
    return path


def atomic_write(path, data, mode=0o600):
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def render(config):
    source = Path(__file__).with_name("docker-compose.yml").read_text()
    if source.count("${GITLAB_URL}") != 1 or re.search(
        r"^\s+hostname:", source, re.MULTILINE
    ):
        raise ValueError(
            "compose template must set external_url once from GITLAB_URL and no hostname"
        )
    return re.sub(r"\$\{([A-Z_]+)\}", lambda match: config[match[1]], source)


def rewrite_rb(text):
    for name, (pattern, line) in RB_LINES.items():
        matches = pattern.findall(text)
        if len(matches) != 1:
            raise ValueError(
                f"gitlab.rb must contain exactly one {name} line, found {len(matches)}"
            )
        text = pattern.sub(lambda match, line=line: line.format(*match.groups()), text)
    return text


def external_url(compose_text):
    found = re.findall(r"^\s+external_url '([^']+)'\s*$", compose_text, re.MULTILINE)
    return found[0] if len(found) == 1 else None


def relative_root(url):
    return urlsplit(url).path.rstrip("/") if url else ""


def network_of(compose_text):
    return re.findall(
        r"^\s+- subnet: (\S+)\n\s+gateway: (\S+)$", compose_text, re.MULTILINE
    )


def run(args, timeout=900):
    result = subprocess.run(
        args, capture_output=True, text=True, timeout=timeout, check=False
    )
    if result.returncode:
        raise RuntimeError("GitLab command failed: " + " ".join(args[:3]))
    return result.stdout


def wait_healthy(docker, url, deadline_seconds):
    path = relative_root(url) + "/-/health"
    deadline = time.monotonic() + deadline_seconds
    while True:
        result = subprocess.run(
            [
                docker,
                "exec",
                CONTAINER,
                "curl",
                "--fail",
                "--silent",
                "--max-time",
                "10",
                "http://127.0.0.1" + path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if result.returncode == 0:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("GitLab health check timed out at " + path)
        time.sleep(min(5, max(0, deadline - time.monotonic())))


def operate(args):
    root = Path(args.root)
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError("root must be a canonical absolute path")
    config = read_config(args.env_file)
    stack = config["GITLAB_STACK_ROOT"].lstrip("/")
    compose = checked_path(root, stack + "/docker-compose.yml")
    rb = checked_path(root, stack + "/config/gitlab.rb")
    url_file = checked_path(root, stack + "/config/yzgc-gitlab-url")
    state = checked_path(root, stack + "/path-move")
    receipt = checked_path(root, stack + "/path-move/receipt.json")
    saved = {
        name: checked_path(root, f"{stack}/path-move/{name}.before")
        for name in ["docker-compose.yml", "gitlab.rb", "yzgc-gitlab-url"]
    }

    current = {
        "docker-compose.yml": compose.read_bytes(),
        "gitlab.rb": rb.read_bytes(),
        "yzgc-gitlab-url": url_file.read_bytes() if url_file.exists() else b"",
    }
    rendered = render(config).encode()
    target = {
        "docker-compose.yml": rendered,
        "gitlab.rb": rewrite_rb(current["gitlab.rb"].decode()).encode(),
        "yzgc-gitlab-url": (config["GITLAB_URL"] + "\n").encode(),
    }
    template_images = re.findall(r"^\s+image: (\S+)$", rendered.decode(), re.MULTILINE)
    if template_images != re.findall(
        r"^\s+image: (\S+)$", current["docker-compose.yml"].decode(), re.MULTILINE
    ):
        raise ValueError(
            "installed GitLab image differs from the locked template; refusing to change versions here"
        )
    if network_of(rendered.decode()) != network_of(
        current["docker-compose.yml"].decode()
    ):
        raise ValueError(
            "installed GitLab network differs from the production template; refusing to change it here"
        )
    moved = current == target
    report = {
        "container": CONTAINER,
        "current_url": external_url(current["docker-compose.yml"].decode()),
        "target_url": config["GITLAB_URL"],
        "moved": moved,
        # Address before the last recorded move; cutover.sh needs it to drop or restore the old OIDC callback.
        "previous_url": external_url(saved["docker-compose.yml"].read_text())
        if receipt.exists()
        else None,
        "gitlab_rb_lines": len(RB_LINES),
        "compose_sha256": digest(rendered),
    }

    if args.action == "plan":
        return {"action": "plan", **report}
    if args.action == "verify":
        if not moved:
            raise ValueError("GitLab is not on its target path")
        wait_healthy(args.docker, config["GITLAB_URL"], 0)
        return {"action": "verify", "healthy": True, **report}
    if not args.apply:
        raise ValueError("writes require --apply")

    state.mkdir(mode=0o700, exist_ok=True)
    lock = checked_path(root, stack + "/path-move/lock")
    with lock.open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        command = [
            args.docker,
            "compose",
            "-f",
            str(compose),
            "up",
            "-d",
            "--no-build",
            "--pull",
            "never",
        ]
        if args.action == "rollback":
            if not receipt.exists():
                raise ValueError("no recorded path move to roll back")
            recorded = json.loads(receipt.read_text())
            before = {name: path.read_bytes() for name, path in saved.items()}
            if any(digest(before[name]) != recorded["before"][name] for name in saved):
                raise ValueError("saved configuration digest mismatch")
            if all(digest(current[name]) == recorded["before"][name] for name in saved):
                return {"action": "rollback", "changed": False, **report}
            if any(digest(current[name]) != recorded["after"][name] for name in saved):
                raise ValueError(
                    "configuration changed after the move; rollback refused"
                )
            restore(compose, rb, url_file, before)
            run(command)
            wait_healthy(
                args.docker,
                external_url(before["docker-compose.yml"].decode()),
                args.health_timeout,
            )
            return {
                "action": "rollback",
                "changed": True,
                "restored_url": external_url(before["docker-compose.yml"].decode()),
            }
        if moved:
            wait_healthy(args.docker, config["GITLAB_URL"], args.health_timeout)
            return {"action": "apply", "changed": False, "healthy": True, **report}
        for name, path in saved.items():
            atomic_write(path, current[name])
        atomic_write(
            receipt,
            json.dumps(
                {
                    "before": {name: digest(data) for name, data in current.items()},
                    "after": {name: digest(data) for name, data in target.items()},
                }
            ).encode(),
        )
        try:
            atomic_write(url_file, target["yzgc-gitlab-url"], 0o644)
            atomic_write(rb, target["gitlab.rb"], rb.stat().st_mode & 0o777)
            atomic_write(compose, rendered, compose.stat().st_mode & 0o777)
            run(command)
            wait_healthy(args.docker, config["GITLAB_URL"], args.health_timeout)
        except FAILURES as error:
            restore(compose, rb, url_file, current)
            try:
                run(command)
                wait_healthy(args.docker, report["current_url"], args.health_timeout)
            except FAILURES:
                raise RuntimeError(
                    "GitLab move failed and the previous container is not healthy yet: "
                    + str(error)
                ) from error
            raise RuntimeError(
                "GitLab move failed; previous configuration restored and healthy: "
                + str(error)
            ) from error
        return {
            "action": "apply",
            "changed": True,
            "healthy": True,
            **report,
            "moved": True,
        }


def restore(compose, rb, url_file, files):
    atomic_write(compose, files["docker-compose.yml"], compose.stat().st_mode & 0o777)
    atomic_write(rb, files["gitlab.rb"], rb.stat().st_mode & 0o777)
    if files["yzgc-gitlab-url"]:
        atomic_write(url_file, files["yzgc-gitlab-url"], 0o644)
    else:
        url_file.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["plan", "apply", "verify", "rollback"])
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--root", default="/")
    parser.add_argument("--docker", default="docker")
    parser.add_argument("--health-timeout", type=int, default=900)
    args = parser.parse_args()
    if args.health_timeout < 0 or args.health_timeout > 1800:
        raise ValueError("invalid readiness deadline")
    print(json.dumps(operate(args)))


if __name__ == "__main__":
    try:
        main()
    except (*FAILURES, KeyError, json.JSONDecodeError) as error:
        print("gitlab-production-path: " + str(error), file=sys.stderr)
        sys.exit(1)
