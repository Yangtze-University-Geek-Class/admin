#!/usr/bin/env python3
"""Only manage the preview GitLab handler; the SSH key cannot upload or execute code."""
import argparse
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit


def target_config(env_file):
    values = {}
    for line in Path(env_file).read_text().splitlines():
        if not line or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key in values:
            raise ValueError('invalid or duplicate environment field')
        values[key] = value
    if values.get('GEEK_DEPLOYMENT_ENVIRONMENT') != 'preview':
        raise ValueError('only the preview environment is supported')
    if values.get('GITLAB_URL') != values.get('PUBLIC_ORIGIN', '') + '/gitlab':
        raise ValueError('preview GitLab must use the /gitlab base path')
    config = {'preview_origin': values.get('PUBLIC_ORIGIN'), 'upstream': values.get('GITLAB_HTTP_BIND')}
    validate_config(config)
    return config


def validate_config(config):
    if not isinstance(config, dict) or set(config) != {'preview_origin', 'upstream'}:
        raise ValueError('invalid edge configuration fields')
    origin = urlsplit(config['preview_origin'])
    if origin.scheme != 'https' or origin.path or origin.query or origin.fragment or origin.username or origin.password or origin.port:
        raise ValueError('invalid preview origin')
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', origin.hostname or ''):
        raise ValueError('invalid preview hostname')
    match = re.fullmatch(r'([0-9.]+):([0-9]+)', config['upstream'])
    if not match or not ipaddress.IPv4Address(match[1]).is_private or not 1024 <= int(match[2]) <= 65535:
        raise ValueError('invalid private GitLab upstream')


def transform(source, config):
    validate_config(config)
    host = urlsplit(config['preview_origin']).hostname
    # Existing project host blocks use a column-zero closing brace. Refuse unfamiliar layouts.
    pattern = re.compile(r'^' + re.escape(host) + r' \{\n.*?^\}', re.M | re.S)
    matches = list(pattern.finditer(source))
    if len(matches) != 1:
        raise ValueError('preview site block is missing or ambiguous')
    match = matches[0]
    block = match[0]
    marker = '    # yzgc:gitlab-preview\n'
    if marker in block:
        if block.count(marker) != 1 or f'reverse_proxy {config["upstream"]} {{' not in block:
            raise ValueError('existing GitLab handler does not match installed target')
        return source
    required = ['    request_body {\n', '    @outside_forum not path /forum/*\n', '    @old_source remote_ip ', '    handle @old_source {\n']
    if any(block.count(part) != 1 for part in required):
        raise ValueError('unrecognized preview policy; refusing to replace it')
    block = block.replace('    request_body {\n', '    @platform_body not path /gitlab /gitlab/*\n    request_body @platform_body {\n', 1)
    block = block.replace('    @outside_forum not path /forum/*\n', '    @outside_forum not path /forum/* /gitlab /gitlab/*\n', 1)
    proxy = '''            reverse_proxy {upstream} {{
                header_up Host {host}
                header_up X-Forwarded-For {client}
                header_up X-Real-IP {client}
                header_up X-Forwarded-Proto https
                transport http {{
                    versions 1.1
                    response_header_timeout 300s
                }}
            }}
'''
    handler = marker + '''    @gitlab_preview path /gitlab /gitlab/*
    handle @gitlab_preview {
        request_body {
            max_size 2147483648
        }
        handle @old_source {
''' + proxy.format(upstream=config['upstream'], host=host, client='{http.request.header.X-Real-IP}') + '''        }
        handle {
''' + proxy.format(upstream=config['upstream'], host=host, client='{http.request.remote.host}') + '''        }
    }
'''
    block = block.replace('    handle @old_source {\n', handler + '    handle @old_source {\n', 1)
    return source[:match.start()] + block + source[match.end():]


def checked_path(root, relative):
    path = root / relative
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError('symlink target refused')
        if parent == root:
            break
    return path


def atomic_write(path, data, mode=0o600):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def run(args):
    result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60, check=False)
    if result.returncode:
        raise RuntimeError('edge validation or reload failed')


def operate(root, action, caddy, systemctl):
    config_path = checked_path(root, 'etc/yzgc-edge/gitlab-preview.json')
    config = json.loads(config_path.read_text())
    validate_config(config)
    site = checked_path(root, 'etc/caddy/sites/yzgc.caddy')
    main = checked_path(root, 'etc/caddy/Caddyfile')
    state_dir = checked_path(root, 'var/lib/yzgc-edge')
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = checked_path(root, 'var/lib/yzgc-edge/lock')
    with lock.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        before = site.read_bytes()
        before_hash = hashlib.sha256(before).hexdigest()
        receipt = checked_path(root, 'var/lib/yzgc-edge/receipt.json')
        backup = checked_path(root, 'var/lib/yzgc-edge/yzgc.caddy.before')
        if action == 'rollback':
            saved = json.loads(receipt.read_text())
            if before_hash != saved['after']:
                raise ValueError('configuration changed after installation; rollback refused')
            after = backup.read_bytes()
            if hashlib.sha256(after).hexdigest() != saved['before']:
                raise ValueError('backup digest mismatch')
        else:
            after = transform(before.decode(), config).encode()
        changed = before != after
        if action == 'plan':
            return {'action': action, 'changed': changed, 'site_sha256': before_hash}
        if action in ('apply', 'verify') and not changed:
            if not receipt.exists() or json.loads(receipt.read_text()).get('after') != before_hash:
                raise ValueError('installed configuration differs from its activation receipt')
        if action == 'verify':
            if changed:
                raise ValueError('GitLab preview handler is not installed')
            run([caddy, 'validate', '--config', str(main)])
            run([systemctl, 'is-active', '--quiet', 'caddy'])
            return {'action': action, 'verified': True, 'site_sha256': before_hash}
        if not changed:
            return {'action': action, 'changed': False, 'site_sha256': before_hash}
        fd, candidate_name = tempfile.mkstemp(prefix='yzgc-edge-', suffix='.caddy', dir=state_dir)
        os.close(fd)
        candidate = Path(candidate_name)
        try:
            candidate.write_bytes(after)
            run([caddy, 'validate', '--config', str(candidate), '--adapter', 'caddyfile'])
            if action == 'apply':
                atomic_write(backup, before)
            atomic_write(site, after, site.stat().st_mode & 0o777)
            try:
                run([caddy, 'validate', '--config', str(main)])
                run([systemctl, 'reload', 'caddy'])
                run([systemctl, 'is-active', '--quiet', 'caddy'])
            except Exception:
                atomic_write(site, before, site.stat().st_mode & 0o777)
                run([caddy, 'validate', '--config', str(main)])
                run([systemctl, 'reload', 'caddy'])
                raise RuntimeError('edge activation failed; previous configuration restored')
            after_hash = hashlib.sha256(after).hexdigest()
            if action == 'apply':
                atomic_write(receipt, json.dumps({'before': before_hash, 'after': after_hash}).encode())
            return {'action': action, 'changed': True, 'site_sha256': after_hash}
        finally:
            candidate.unlink(missing_ok=True)


def main():
    if 'SSH_ORIGINAL_COMMAND' in os.environ:
        command = os.environ['SSH_ORIGINAL_COMMAND']
        if command not in ('plan', 'apply', 'verify', 'rollback') or len(sys.argv) != 1:
            raise ValueError('only fixed edge actions are allowed')
        return operate(Path('/'), command, '/usr/local/bin/caddy', '/usr/bin/systemctl')
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['plan', 'apply', 'verify', 'rollback', 'bootstrap'])
    parser.add_argument('--root', default='/')
    parser.add_argument('--env-file')
    parser.add_argument('--public-key-stdin', action='store_true')
    parser.add_argument('--caddy', default='/usr/local/bin/caddy')
    parser.add_argument('--systemctl', default='/usr/bin/systemctl')
    args = parser.parse_args()
    root = Path(args.root)
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError('root must be a canonical absolute path')
    if args.action == 'bootstrap':
        config = target_config(args.env_file)
        public_key = sys.stdin.read(4096).strip() if args.public_key_stdin else None
        if public_key is not None and not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]{60,120}={0,2}(?: [A-Za-z0-9_.@-]+)?', public_key):
            raise ValueError('one valid dedicated ed25519 public key is required')
        path = checked_path(root, 'etc/yzgc-edge/gitlab-preview.json')
        if path.exists() and json.loads(path.read_text()) != config:
            raise ValueError('installed edge target differs; explicit migration required')
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        atomic_write(path, json.dumps(config).encode())
        if public_key:
            key = ' '.join(public_key.split()[:2])
            line = 'restrict,command="/usr/bin/python3 /usr/local/libexec/yzgc-edge" ' + key + ' yzgc-edge-deploy'
            authorized = checked_path(root, 'root/.ssh/authorized_keys')
            before = authorized.read_text() if authorized.exists() else ''
            existing = [entry for entry in before.splitlines() if entry.endswith(' yzgc-edge-deploy') or key.split()[1] in entry]
            if existing and existing != [line]:
                raise ValueError('dedicated key already differs; refusing implicit rotation')
            if not existing:
                authorized.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                state = checked_path(root, 'var/lib/yzgc-edge')
                state.mkdir(parents=True, exist_ok=True, mode=0o700)
                atomic_write(state / 'authorized_keys.before', before.encode())
                atomic_write(authorized, (before + ('\n' if before and not before.endswith('\n') else '') + line + '\n').encode())
        return {'action': 'bootstrap', 'configured': True}
    return operate(root, args.action, args.caddy, args.systemctl)


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except Exception as error:
        print('edge-gitlab: ' + str(error), file=sys.stderr)
        sys.exit(1)
