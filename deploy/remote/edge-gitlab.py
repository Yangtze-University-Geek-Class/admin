#!/usr/bin/env python3
"""Only manage the GitLab handlers of the two site blocks; the SSH key cannot upload or execute code.

The preview handler serves <preview origin>/gitlab (#308). The production handler (#335) serves <production origin>/gitlab
and replaces the old GitLab host file with the installed redirect-only material. Both serve the same NANO avatar pool
from the files shared on this host (#335).
"""
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


def production_config(env_file):
    values = {}
    for line in Path(env_file).read_text().splitlines():
        if not line or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key in values:
            raise ValueError('invalid or duplicate environment field')
        values[key] = value
    if values.get('GEEK_DEPLOYMENT_ENVIRONMENT') != 'production':
        raise ValueError('production environment file required')
    if values.get('GITLAB_URL') != values.get('PUBLIC_ORIGIN', '') + '/gitlab':
        raise ValueError('production GitLab must use the /gitlab base path')
    config = {'production_origin': values.get('PUBLIC_ORIGIN'), 'upstream': values.get('GITLAB_HTTP_BIND')}
    validate_config(config, 'production_origin')
    return config


def validate_config(config, origin_key='preview_origin'):
    if not isinstance(config, dict) or set(config) != {origin_key, 'upstream'}:
        raise ValueError('invalid edge configuration fields')
    origin = urlsplit(config[origin_key])
    if origin.scheme != 'https' or origin.path or origin.query or origin.fragment or origin.username or origin.password or origin.port:
        raise ValueError('invalid preview origin')
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', origin.hostname or ''):
        raise ValueError('invalid preview hostname')
    match = re.fullmatch(r'([0-9.]+):([0-9]+)', config['upstream'])
    if not match or not ipaddress.IPv4Address(match[1]).is_private or not 1024 <= int(match[2]) <= 65535:
        raise ValueError('invalid private GitLab upstream')


AVATAR_ROOT = '/var/lib/caddy/gitlab-avatars/20261025'


def nano_avatar_routes():
    """The NANO avatar pool under <origin>/gitlab; it used to live on the old GitLab host, same mapping and files."""
    avatars = ''.join(f'                {digit} avatar-{"0123456789abcdef".index(digit) % 8 + 1:02d}.png\n' for digit in '08192a3b4c5d6e7f')
    static = (
        f'            root * {AVATAR_ROOT}\n'
        '            rewrite * /{file}\n'
        '            header Cache-Control "public, max-age=86400"\n'
        '            header X-Content-Type-Options nosniff\n'
        '            file_server\n'
    )
    return (
        '        @gitlab_nano_avatar path_regexp gitlab_nano_avatar ^/gitlab/nano-avatar/20261025/([0-9a-f])[0-9a-f]{63}$\n'
        + '        handle @gitlab_nano_avatar {\n'
        + '            map {re.gitlab_nano_avatar.1} {gitlab_nano_avatar_file} {\n'
        + avatars
        + '            }\n'
        + static.replace('{file}', '{gitlab_nano_avatar_file}')
        + '        }\n'
        + '        @gitlab_nano_fallback path_regexp ^/gitlab/assets/no_avatar(-[a-f0-9]+)?\\.png$\n'
        + '        handle @gitlab_nano_fallback {\n'
        + static.replace('{file}', 'avatar-01.png')
        + '        }\n'
    )


PREVIEW_MARKER = '    # yzgc:gitlab-preview\n'


def preview_handler(config, avatars=True):
    """avatars=False is the exact handler installed before the preview got the NANO avatar routes (#335)."""
    host = urlsplit(config['preview_origin']).hostname
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
    return PREVIEW_MARKER + '''    @gitlab_preview path /gitlab /gitlab/*
    handle @gitlab_preview {
        request_body {
            max_size 2147483648
        }
''' + (nano_avatar_routes() if avatars else '') + '''        handle @old_source {
''' + proxy.format(upstream=config['upstream'], host=host, client='{http.request.header.X-Real-IP}') + '''        }
        handle {
''' + proxy.format(upstream=config['upstream'], host=host, client='{http.request.remote.host}') + '''        }
    }
'''


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
    handler = preview_handler(config)
    if PREVIEW_MARKER in block:
        if block.count(PREVIEW_MARKER) == 1 and block.count(handler) == 1:
            return source
        # A handler installed before the avatar routes is upgraded in place, but only if it is exactly that text.
        earlier = preview_handler(config, avatars=False)
        if block.count(PREVIEW_MARKER) != 1 or block.count(earlier) != 1:
            raise ValueError('existing GitLab handler does not match installed target')
        return source[:match.start()] + block.replace(earlier, handler, 1) + source[match.end():]
    required = ['    request_body {\n', '    @outside_forum not path /forum/*\n', '    @old_source remote_ip ', '    handle @old_source {\n']
    if any(block.count(part) != 1 for part in required):
        raise ValueError('unrecognized preview policy; refusing to replace it')
    block = block.replace('    request_body {\n', '    @platform_body not path /gitlab /gitlab/*\n    request_body @platform_body {\n', 1)
    block = block.replace('    @outside_forum not path /forum/*\n', '    @outside_forum not path /forum/* /gitlab /gitlab/*\n', 1)
    block = block.replace('    handle @old_source {\n', handler + '    handle @old_source {\n', 1)
    return source[:match.start()] + block + source[match.end():]


PRODUCTION_BEGIN = '    # yzgc:gitlab-production begin\n'
PRODUCTION_END = '    # yzgc:gitlab-production end\n'
# Site policy lines the production handler bypasses for /gitlab, as (original, installed).
PRODUCTION_EDITS = [
    ('    request_body {\n', '    @platform_body not path /gitlab /gitlab/*\n    request_body @platform_body {\n'),
    ('    @outside_forum not path /forum/*\n', '    @outside_forum not path /forum/* /gitlab /gitlab/*\n'),
]


def production_handler(config):
    host = urlsplit(config['production_origin']).hostname
    proxy = (
        '            reverse_proxy {upstream} {{\n'
        '                header_up Host {host}\n'
        '                header_up X-Forwarded-For {client}\n'
        '                header_up X-Real-IP {client}\n'
        '                header_up X-Forwarded-Proto https\n'
        '                flush_interval -1\n'
        '                transport http {{\n'
        '                    versions 1.1\n'
        '                    response_header_timeout 300s\n'
        '                }}\n'
        '            }}\n'
    )
    return (
        PRODUCTION_BEGIN
        + '    @gitlab_production path /gitlab /gitlab/*\n'
        + '    handle @gitlab_production {\n'
        + '        request_body {\n'
        + '            max_size 2147483648\n'
        + '        }\n'
        + nano_avatar_routes()
        + '        handle @old_source {\n'
        + proxy.format(upstream=config['upstream'], host=host, client='{http.request.header.X-Real-IP}')
        + '        }\n'
        + '        handle {\n'
        + proxy.format(upstream=config['upstream'], host=host, client='{http.request.remote.host}')
        + '        }\n'
        + '    }\n'
        + PRODUCTION_END
    )


def production_block(source, config):
    validate_config(config, 'production_origin')
    host = urlsplit(config['production_origin']).hostname
    pattern = re.compile(r'^' + re.escape(host) + r' \{\n.*?^\}', re.MULTILINE | re.DOTALL)
    matches = list(pattern.finditer(source))
    if len(matches) != 1:
        raise ValueError('production site block is missing or ambiguous')
    return matches[0]


def transform_production(source, config):
    match = production_block(source, config)
    block = match[0]
    handler = production_handler(config)
    if PRODUCTION_BEGIN in block:
        if block.count(handler) != 1:
            raise ValueError('existing GitLab handler does not match installed target')
        return source
    required = [original for original, _ in PRODUCTION_EDITS] + ['    @old_source remote_ip ', '    handle @old_source {\n']
    if any(block.count(part) != 1 for part in required) or '/gitlab' in block:
        raise ValueError('unrecognized production policy; refusing to replace it')
    for original, installed in PRODUCTION_EDITS:
        block = block.replace(original, installed, 1)
    block = block.replace('    handle @old_source {\n', handler + '    handle @old_source {\n', 1)
    return source[:match.start()] + block + source[match.end():]


def untransform_production(source, config):
    match = production_block(source, config)
    block = match[0]
    handler = production_handler(config)
    if block.count(handler) != 1 or any(block.count(installed) != 1 for _, installed in PRODUCTION_EDITS):
        raise ValueError('installed GitLab handler not found; rollback refused')
    block = block.replace(handler, '', 1)
    for original, installed in PRODUCTION_EDITS:
        block = block.replace(installed, original, 1)
    return source[:match.start()] + block + source[match.end():]


def legacy_target(material, current, config):
    """The old GitLab host file becomes the installed redirect-only material, but only from the known proxy block."""
    lines = '\n'.join(line for line in material.splitlines() if line.strip() and not line.lstrip().startswith('#'))
    redirect = re.fullmatch(r'([a-z0-9]+(?:[.-][a-z0-9]+)*) \{\n\s+redir (\S+) 301\n\}', lines)
    if not redirect or redirect[2] != config['production_origin'] + '/gitlab{uri}':
        raise ValueError('redirect material must only send its host to the production GitLab path')
    if current == material:
        return current
    addresses = [line for line in current.splitlines() if line.strip() and not line.lstrip().startswith('#')][:1]
    if addresses != [redirect[1] + ' {'] or current.count(f'reverse_proxy {config["upstream"]} {{') != 1:
        raise ValueError('old GitLab host file is not the known proxy block; refusing to replace it')
    return material


def operate_production(root, action, caddy, systemctl):
    config = json.loads(checked_path(root, 'etc/yzgc-edge/gitlab-production.json').read_text())
    validate_config(config, 'production_origin')
    site = checked_path(root, 'etc/caddy/sites/yzgc.caddy')
    legacy = checked_path(root, 'etc/caddy/sites/gitlab.caddy')
    material = checked_path(root, 'usr/local/share/yzgc-edge/gitlab-legacy.caddy').read_text()
    main = checked_path(root, 'etc/caddy/Caddyfile')
    state_dir = checked_path(root, 'var/lib/yzgc-edge')
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    receipt = checked_path(root, 'var/lib/yzgc-edge/production-receipt.json')
    legacy_backup = checked_path(root, 'var/lib/yzgc-edge/gitlab.caddy.before')
    preview_receipt = checked_path(root, 'var/lib/yzgc-edge/receipt.json')
    preview_backup = checked_path(root, 'var/lib/yzgc-edge/yzgc.caddy.before')
    with checked_path(root, 'var/lib/yzgc-edge/lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        site_before, legacy_before = site.read_text(), legacy.read_text()
        if action == 'rollback':
            if not receipt.exists():
                raise ValueError('GitLab production handler was never activated here; nothing to roll back')
            saved = json.loads(receipt.read_text())
            restored = legacy_backup.read_text()
            if sha(legacy_before) != saved['legacy_after'] or sha(restored) != saved['legacy_before']:
                raise ValueError('configuration changed after installation; rollback refused')
            site_after, legacy_after = untransform_production(site_before, config), restored
        else:
            site_after, legacy_after = transform_production(site_before, config), legacy_target(material, legacy_before, config)
        changed = (site_before, legacy_before) != (site_after, legacy_after)
        summary = {'site_sha256': sha(site_after), 'legacy_sha256': sha(legacy_after)}
        if action == 'plan':
            return {'action': 'production-plan', 'changed': changed, **summary}
        if action in ('apply', 'verify') and not changed and (not receipt.exists() or json.loads(receipt.read_text()).get('legacy_after') != sha(legacy_before)):
            raise ValueError('installed configuration differs from its activation receipt')
        if action == 'verify':
            if changed:
                raise ValueError('GitLab production handler is not installed')
            run([caddy, 'validate', '--config', str(main)])
            run([systemctl, 'is-active', '--quiet', 'caddy'])
            return {'action': 'production-verify', 'verified': True, **summary}
        if not changed:
            return {'action': 'production-' + action, 'changed': False, **summary}
        # The preview receipt pins the whole shared site file: while it describes the current file, carry this change
        # into its backup so preview verify and rollback keep working and a preview rollback cannot undo the production
        # handler. A receipt left behind by a preview rollback no longer describes the file and stays as it is.
        preview_state = None
        if preview_receipt.exists() and json.loads(preview_receipt.read_text()).get('after') == sha(site_before):
            backup_text = preview_backup.read_text()
            moved = untransform_production(backup_text, config) if action == 'rollback' else transform_production(backup_text, config)
            preview_state = (moved, {'before': sha(moved), 'after': sha(site_after)})
        candidates = []
        try:
            for text in (site_after, legacy_after):
                fd, name = tempfile.mkstemp(prefix='yzgc-edge-', suffix='.caddy', dir=state_dir)
                os.close(fd)
                candidates.append(Path(name))
                candidates[-1].write_text(text)
                run([caddy, 'validate', '--config', name, '--adapter', 'caddyfile'])
            if action == 'apply':
                atomic_write(legacy_backup, legacy_before.encode())
            atomic_write(site, site_after.encode(), site.stat().st_mode & 0o777)
            atomic_write(legacy, legacy_after.encode(), legacy.stat().st_mode & 0o777)
            try:
                run([caddy, 'validate', '--config', str(main)])
                run([systemctl, 'reload', 'caddy'])
                run([systemctl, 'is-active', '--quiet', 'caddy'])
            except (RuntimeError, OSError, subprocess.SubprocessError):
                atomic_write(site, site_before.encode(), site.stat().st_mode & 0o777)
                atomic_write(legacy, legacy_before.encode(), legacy.stat().st_mode & 0o777)
                run([caddy, 'validate', '--config', str(main)])
                run([systemctl, 'reload', 'caddy'])
                raise RuntimeError('edge activation failed; previous configuration restored') from None
            if action == 'apply':
                atomic_write(receipt, json.dumps({'legacy_before': sha(legacy_before), 'legacy_after': sha(legacy_after)}).encode())
            if preview_state:
                atomic_write(preview_backup, preview_state[0].encode())
                atomic_write(preview_receipt, json.dumps(preview_state[1]).encode())
            return {'action': 'production-' + action, 'changed': True, **summary}
        finally:
            for candidate in candidates:
                candidate.unlink(missing_ok=True)


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


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
                raise ValueError('GitLab preview handler is missing or outdated')
            run([caddy, 'validate', '--config', str(main)])
            run([systemctl, 'is-active', '--quiet', 'caddy'])
            return {'action': action, 'verified': True, 'site_sha256': before_hash}
        if not changed:
            return {'action': action, 'changed': False, 'site_sha256': before_hash}
        # Upgrading an installed handler keeps the pre-install backup, so rollback still removes the whole handler;
        # that needs a receipt describing the current file.
        upgrade = action == 'apply' and PREVIEW_MARKER in before.decode()
        if upgrade and (not receipt.exists() or json.loads(receipt.read_text()).get('after') != before_hash):
            raise ValueError('installed configuration differs from its activation receipt')
        fd, candidate_name = tempfile.mkstemp(prefix='yzgc-edge-', suffix='.caddy', dir=state_dir)
        os.close(fd)
        candidate = Path(candidate_name)
        try:
            candidate.write_bytes(after)
            run([caddy, 'validate', '--config', str(candidate), '--adapter', 'caddyfile'])
            if action == 'apply' and not upgrade:
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
                original = json.loads(receipt.read_text())['before'] if upgrade else before_hash
                atomic_write(receipt, json.dumps({'before': original, 'after': after_hash}).encode())
            return {'action': action, 'changed': True, 'site_sha256': after_hash}
        finally:
            candidate.unlink(missing_ok=True)


def main():
    if 'SSH_ORIGINAL_COMMAND' in os.environ:
        command = os.environ['SSH_ORIGINAL_COMMAND']
        if command not in ACTIONS or len(sys.argv) != 1:
            raise ValueError('only fixed edge actions are allowed')
        return dispatch(Path('/'), command, '/usr/local/bin/caddy', '/usr/bin/systemctl')
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=[*ACTIONS, 'bootstrap'])
    parser.add_argument('--root', default='/')
    parser.add_argument('--env-file')
    parser.add_argument('--production-env-file')
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
        targets = [('etc/yzgc-edge/gitlab-preview.json', config)]
        if args.production_env_file:
            targets.append(('etc/yzgc-edge/gitlab-production.json', production_config(args.production_env_file)))
        for relative, target in targets:
            path = checked_path(root, relative)
            if path.exists() and json.loads(path.read_text()) != target:
                raise ValueError('installed edge target differs; explicit migration required')
        for relative, target in targets:
            path = checked_path(root, relative)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            atomic_write(path, json.dumps(target).encode())
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
    return dispatch(root, args.action, args.caddy, args.systemctl)


ACTIONS = ('plan', 'apply', 'verify', 'rollback', 'production-plan', 'production-apply', 'production-verify', 'production-rollback')


def dispatch(root, action, caddy, systemctl):
    if action.startswith('production-'):
        return operate_production(root, action.removeprefix('production-'), caddy, systemctl)
    return operate(root, action, caddy, systemctl)


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except Exception as error:
        print('edge-gitlab: ' + str(error), file=sys.stderr)
        sys.exit(1)
