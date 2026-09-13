#!/usr/bin/env python3
"""Capture authorized forum sources over SSH; never modify a live source database.

Only a private remote temporary directory is written, and it is removed on exit.
SSH credentials are resolved by OpenSSH, never read or logged by this program.
The archive contains private records; keep its destination outside public/build trees.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
REMOTE = r'''
import hashlib, io, json, os, pathlib, sqlite3, sys, tarfile, tempfile, time
spec = json.loads(sys.stdin.readline())
def digest(data): return hashlib.sha256(data).hexdigest()
def quote(name): return '"' + name.replace('"', '""') + '"'
manifest = {'schema_version': 1, 'captured_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'method': 'sqlite-online-backup', 'databases': {}, 'files': []}
with tempfile.TemporaryDirectory(prefix='geek-forum-read-export-') as scratch:
    backups = []
    for label, source in spec['databases'].items():
        if not os.path.isfile(source): raise RuntimeError('Required database missing: ' + label)
        origin = sqlite3.connect(pathlib.Path(source).as_uri() + '?mode=ro', uri=True, timeout=15)
        origin.execute('PRAGMA query_only=ON')
        origin.execute('PRAGMA trusted_schema=OFF')
        target = os.path.join(scratch, label + '.sqlite')
        copy = sqlite3.connect(target)
        origin.backup(copy, pages=128, sleep=0.05)
        if copy.execute('PRAGMA quick_check').fetchone()[0] != 'ok': raise RuntimeError('Database integrity failure: ' + label)
        tables = [row[0] for row in copy.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        counts = {name: copy.execute('SELECT COUNT(*) FROM ' + quote(name)).fetchone()[0] for name in tables}
        manifest['databases'][label] = {'source': source, 'tables': counts}
        copy.close(); origin.close()
        os.chmod(target, 0o600)
        backups.append((label + '.sqlite', target))
    with tarfile.open(fileobj=sys.stdout.buffer, mode='w|gz') as archive:
        def add(name, source):
            if os.path.islink(source): raise RuntimeError('Symlink source rejected')
            with open(source, 'rb') as stream:
                before = os.fstat(stream.fileno())
                if before.st_size > 128 * 1024 * 1024: raise RuntimeError('Oversized file')
                data = stream.read()
                after = os.fstat(stream.fileno())
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns): raise RuntimeError('Source changed during attachment capture')
            entry = tarfile.TarInfo(name); entry.size = len(data); entry.mode = 0o600
            archive.addfile(entry, io.BytesIO(data))
            manifest['files'].append({'path': name, 'bytes': len(data), 'sha256': digest(data)})
        for name, source in backups: add(name, source)
        for label, directory in spec['attachments'].items():
            if not os.path.isdir(directory): raise RuntimeError('Required attachment directory missing: ' + label)
            for parent, dirs, files in os.walk(directory, followlinks=False):
                dirs.sort()
                if any(os.path.islink(os.path.join(parent, name)) for name in dirs): raise RuntimeError('Directory symlink rejected')
                for name in sorted(files):
                    source = os.path.join(parent, name)
                    add('attachments/' + label + '/' + os.path.relpath(source, directory), source)
        data = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
        entry = tarfile.TarInfo('manifest.json'); entry.size = len(data); entry.mode = 0o600
        archive.addfile(entry, io.BytesIO(data))
'''


def extract_verified(archive_path: Path, destination: Path):
    """Extract only unique regular files, without tar permissions/links/path traversal."""
    found = set()
    total = 0
    with tarfile.open(archive_path, 'r:gz') as archive:
        for item in archive:
            name = Path(item.name)
            if not item.isfile() or name.is_absolute() or '..' in name.parts or '\\' in item.name:
                raise ValueError('Unsafe archive member')
            if item.name in found or item.size > 128 * 1024 * 1024 or len(found) > 10000:
                raise ValueError('Invalid archive membership/size')
            total += item.size
            if total > 512 * 1024 * 1024:
                raise ValueError('Archive exceeds approved bound')
            found.add(item.name)
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with archive.extractfile(item) as source, target.open('xb') as output:
                os.chmod(target, 0o600)
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
    manifest = json.loads((destination / 'manifest.json').read_text())
    if manifest.get('schema_version') != 1:
        raise ValueError('Unsupported manifest')
    if found != {'manifest.json'} | {item['path'] for item in manifest['files']}:
        raise ValueError('Manifest and archive disagree')
    for item in manifest['files']:
        data = (destination / item['path']).read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Transfer integrity failure')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True, help='One authorized OpenSSH destination')
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--destination', required=True, help='New directory under .tools/forum-migration/')
    parser.add_argument('--source-root', default='/opt/yzgc-admin/data')
    parser.add_argument('--legacy-root', default='/root/geek-mbbs')
    args = parser.parse_args()
    if args.host.startswith('-') or any(c.isspace() for c in args.host) or not 1 <= args.port <= 65535:
        raise ValueError('Invalid SSH target')
    destination = Path(args.destination).resolve()
    private_root = ROOT / '.tools' / 'forum-migration'
    if private_root not in destination.parents or destination.exists():
        raise ValueError('Destination must be a fresh private migration directory')
    spec = {
        'databases': {'forum': args.source_root + '/forum.db', 'mbbs-snapshot': args.source_root + '/bbs-snapshot.db', 'mbbs-original': args.legacy_root + '/bbs.db'},
        'attachments': {'legacy': args.source_root + '/legacy-resources', 'uploads': args.source_root + '/forum-uploads', 'mbbs-original': args.legacy_root + '/resources'},
    }
    # JSON is data on stdin; the remote Python body is our fixed program, not source data.
    command = 'python3 -c ' + shlex.quote(REMOTE)
    argv = ['/usr/bin/ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=12', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-p', str(args.port), args.host, command]
    os.umask(0o077)
    destination.mkdir(parents=True, mode=0o700)
    archive_path = destination / 'transfer.tar.gz'
    with archive_path.open('xb') as output:
        result = subprocess.run(argv, input=(json.dumps(spec) + '\n').encode(), stdout=output, stderr=subprocess.PIPE, timeout=240)
    if result.returncode:
        raise RuntimeError('SSH capture failed; incomplete private output retained, no import attempted')
    manifest = extract_verified(archive_path, destination / 'source')
    print(json.dumps({'destination': str(destination.relative_to(ROOT)), 'captured_at': manifest['captured_at'], 'databases': manifest['databases'], 'verified_files': len(manifest['files']), 'bytes': sum(item['bytes'] for item in manifest['files']), 'archive_sha256': hashlib.sha256(archive_path.read_bytes()).hexdigest()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
