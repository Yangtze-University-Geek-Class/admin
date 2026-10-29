#!/usr/bin/env python3
"""Install only the independent preview instance from canonical environment metadata."""
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
import time
from urllib.parse import urlsplit


CONTAINER = 'gitlab-preview'


def read_config(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if not line or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key in values:
            raise ValueError('invalid or duplicate environment field')
        values[key] = value
    expected = {'GEEK_DEPLOYMENT_ENVIRONMENT': 'preview', 'GITLAB_STACK_ROOT': '/srv/gitlab-preview',
                'GITLAB_OIDC_CLIENT': 'gitlab_preview'}
    if any(values.get(key) != value for key, value in expected.items()):
        raise ValueError('preview target identity does not match')
    origin = urlsplit(values.get('PUBLIC_ORIGIN', ''))
    if origin.scheme != 'https' or origin.path or origin.query or origin.fragment or origin.username or origin.password or origin.port:
        raise ValueError('invalid preview origin')
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', origin.hostname or ''):
        raise ValueError('invalid preview host')
    if values.get('GITLAB_URL') != values['PUBLIC_ORIGIN'] + '/gitlab':
        raise ValueError('preview GitLab must have its own /gitlab base URL')
    binding = re.fullmatch(r'([0-9.]+):([0-9]+)', values.get('GITLAB_HTTP_BIND', ''))
    if not binding or binding[1] != values.get('DEPLOY_HOST') or not ipaddress.ip_address(binding[1]).is_private or int(binding[2]) != 8930:
        raise ValueError('invalid preview-only GitLab binding')
    subnet = ipaddress.ip_network(values.get('GITLAB_DOCKER_SUBNET', ''), strict=True)
    gateway = ipaddress.ip_address(values.get('GITLAB_DOCKER_GATEWAY', ''))
    if str(subnet) != '172.31.30.0/24' or gateway != subnet.network_address + 1:
        raise ValueError('invalid preview-only network')
    return {key: values[key] for key in ['GITLAB_URL', 'GITLAB_STACK_ROOT', 'GITLAB_HTTP_BIND', 'GITLAB_DOCKER_SUBNET', 'GITLAB_DOCKER_GATEWAY']}


def checked_path(root, relative):
    path = root / relative
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError('symlink target refused')
        if parent == root:
            break
    return path


def atomic_write(path, data):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def run(args, *, input=None, absent=False):
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=600, check=False)
    if absent and result.returncode:
        return None
    if result.returncode:
        raise RuntimeError('GitLab preview command failed: ' + ' '.join(args[:3]))
    return result.stdout


def install(args):
    root = Path(args.root)
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError('root must be a canonical absolute path')
    config = read_config(args.env_file)
    stack = checked_path(root, config['GITLAB_STACK_ROOT'].lstrip('/'))
    marker = checked_path(root, 'srv/gitlab-preview/installation.json')
    compose = checked_path(root, 'srv/gitlab-preview/docker-compose.yml')
    source = Path(__file__).with_name('preview-compose.yml').read_text()
    images = re.findall(r'^\s+image: (\S+)$', source, re.M)
    production_images = re.findall(r'^\s+image: (\S+)$', Path(__file__).with_name('docker-compose.yml').read_text(), re.M)
    if len(images) != 1 or images != production_images or not re.fullmatch(r'gitlab/gitlab-ce@sha256:[0-9a-f]{64}', images[0]):
        raise ValueError('preview image must match the locked production CE digest')
    rendered_values = {**config, 'GITLAB_STACK_ROOT': str(stack)}
    rendered = re.sub(r'\$\{([A-Z_]+)\}', lambda match: rendered_values[match[1]], source).encode()
    digest = hashlib.sha256(rendered).hexdigest()
    if stack.exists() and not marker.is_file():
        raise ValueError('existing unowned preview directory; refusing to adopt or overwrite')
    if marker.exists():
        saved = json.loads(marker.read_text())
        if saved != {'config': config, 'compose_sha256': digest} or not compose.exists() or hashlib.sha256(compose.read_bytes()).hexdigest() != digest:
            raise ValueError('preview installation drift; refusing implicit reconfiguration')
    current = run([args.docker, 'inspect', CONTAINER], absent=True)
    if current:
        details = json.loads(current)
        if len(details) != 1 or details[0]['Config'].get('Labels', {}).get('com.docker.compose.project') != CONTAINER:
            raise ValueError('container name is already owned by another deployment')
        mounts = {item['Destination']: item['Source'] for item in details[0].get('Mounts', [])}
        if any(mounts.get(target) != str(stack / name) for name, target in [('config', '/etc/gitlab'), ('logs', '/var/log/gitlab'), ('data', '/var/opt/gitlab')]):
            raise ValueError('preview container mounts do not match this instance')
    run([args.docker, 'image', 'inspect', images[0]])
    if args.action == 'plan':
        return {'action': 'plan', 'container': CONTAINER, 'installed': marker.exists(), 'running': bool(current), 'compose_sha256': digest}
    if args.action == 'verify':
        if not marker.exists() or not current or details[0]['State'].get('Health', {}).get('Status') != 'healthy':
            raise ValueError('preview instance is not installed and healthy')
        return {'action': 'verify', 'container': CONTAINER, 'healthy': True, 'compose_sha256': digest}
    if not args.apply:
        raise ValueError('writes require apply --apply')
    lock = checked_path(root, 'run/yzgc-gitlab-preview.lock')
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        if not marker.exists():
            stack.mkdir(parents=True, exist_ok=False, mode=0o700)
            for directory in ['config', 'logs', 'data']:
                (stack / directory).mkdir(mode=0o700)
            atomic_write(compose, rendered)
            atomic_write(marker, json.dumps({'config': config, 'compose_sha256': digest}).encode())
        command = [args.docker, 'compose', '-f', str(compose)]
        was_running = bool(current and details[0]['State'].get('Running'))
        try:
            run([*command, 'up', '-d', '--no-build', '--pull', 'never'])
            deadline = time.monotonic() + args.health_timeout
            while True:
                state = json.loads(run([args.docker, 'inspect', CONTAINER]))[0]['State']
                if state.get('Health', {}).get('Status') == 'healthy':
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('preview readiness timed out')
                time.sleep(min(3, max(0, deadline - time.monotonic())))
            run([args.docker, 'exec', '-i', CONTAINER, 'gitlab-rails', 'runner', '-'], input="ApplicationSetting.current.update!(signup_enabled: false, enabled_git_access_protocol: 'http', usage_ping_enabled: false)\nputs 'preview registration disabled'\n")
        except Exception:
            if not was_running:
                run([*command, 'stop', '--timeout', '120'])
            raise
        return {'action': 'apply', 'container': CONTAINER, 'healthy': True, 'registration': 'disabled', 'compose_sha256': digest}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['plan', 'apply', 'verify'])
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--root', default='/')
    parser.add_argument('--docker', default='docker')
    parser.add_argument('--health-timeout', type=int, default=900)
    args = parser.parse_args()
    if args.health_timeout < 0 or args.health_timeout > 1800:
        raise ValueError('invalid readiness deadline')
    print(json.dumps(install(args)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('gitlab-preview: ' + str(error), file=sys.stderr)
        sys.exit(1)
