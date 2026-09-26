#!/usr/bin/env python3
"""Read-only verification of a captured private forum backup, with in-memory restore.

Do not use immutable=1 on a live database. Here it is only used after hashing
standalone SQLite online-backup images that have no external WAL dependency.
No source rows, credentials or message bodies are printed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]


def main_checkout(root=ROOT):
    """The main checkout, also when the tools run from a task worktree.

    Captures and projections live in its .tools: `task.mjs finish` deletes a task
    worktree with everything in it, and a capture is the only copy. Relative CLI
    paths (`.tools/forum-migration/<name>`) are resolved against it.
    """
    common = subprocess.check_output(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd=root, text=True).strip()
    return Path(common).parent


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def safe_file(root, name):
    path = Path(name)
    if not name or path.is_absolute() or '..' in path.parts or '\\' in name:
        raise ValueError('Unsafe manifest path')
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Symlink in backup')
    if not current.is_file():
        raise ValueError('Missing manifest file')
    return current


def verify_snapshot(base):
    base = Path(base).resolve()
    source = base / 'source'
    manifest = json.loads(safe_file(source, 'manifest.json').read_text())
    if manifest.get('schema_version') != 1 or manifest.get('method') != 'sqlite-online-backup':
        raise ValueError('Unsupported backup manifest')
    files = manifest['files']
    names = {item['path'] for item in files}
    if len(names) != len(files) or not files:
        raise ValueError('Duplicate or empty backup manifest')
    # Bind extracted files to the original archive, not a separately editable manifest.
    archive = safe_file(base, 'transfer.tar.gz')
    archive_names = set()
    archive_manifest = None
    total = 0
    with tarfile.open(archive, 'r:gz') as transfer:
        for member in transfer:
            path = Path(member.name)
            if not member.isfile() or path.is_absolute() or '..' in path.parts or '\\' in member.name:
                raise ValueError('Unsafe transfer archive')
            if member.name in archive_names or len(archive_names) > 10000:
                raise ValueError('Duplicate or oversized archive index')
            archive_names.add(member.name)
            total += member.size
            if total > 512 * 1024 * 1024:
                raise ValueError('Oversized transfer archive')
            if member.name == 'manifest.json':
                if member.size > 4 * 1024 * 1024:
                    raise ValueError('Oversized manifest')
                archive_manifest = transfer.extractfile(member).read()
    if archive_names != names | {'manifest.json'} or archive_manifest != (source / 'manifest.json').read_bytes():
        raise ValueError('Extracted manifest differs from captured archive')
    for item in files:
        path = safe_file(source, item['path'])
        if path.stat().st_size != item['bytes'] or digest(path) != item['sha256']:
            raise ValueError('Backup file hash or size mismatch')
        if stat.S_IMODE(path.stat().st_mode) & 0o077:
            raise ValueError('Backup permissions expose private data')
    actual = {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}
    if actual != names | {'manifest.json'}:
        raise ValueError('Unexpected file in captured source directory')
    if any(stat.S_IMODE(p.stat().st_mode) & 0o077 for p in [base, source]):
        raise ValueError('Private directory permissions are too broad')
    results = {}
    for name, info in manifest['databases'].items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name) or name + '.sqlite' not in names:
            raise ValueError('Invalid database reference')
        path = safe_file(source, name + '.sqlite')
        db = sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)
        restored = sqlite3.connect(':memory:')
        try:
            db.execute('PRAGMA query_only=ON')
            db.backup(restored)
            check = restored.execute('PRAGMA integrity_check').fetchall()
            if check != [('ok',)]:
                raise ValueError('Restored database integrity failure')
            tables = [r[0] for r in restored.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            counts = {table: restored.execute('SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0] for table in tables}
            if counts != info['tables']:
                raise ValueError('Restored table counts differ from capture')
            results[name] = {'integrity_check': 'ok', 'restored_counts_match': True, 'tables': counts}
        finally:
            restored.close()
            db.close()
    lookup = {item['path']: item['sha256'] for item in files}
    legacy = {k[len('attachments/legacy/'):]: v for k, v in lookup.items() if k.startswith('attachments/legacy/')}
    original = {k[len('attachments/mbbs-original/'):]: v for k, v in lookup.items() if k.startswith('attachments/mbbs-original/')}
    attachments = {}
    for label in ['legacy', 'uploads', 'mbbs-original']:
        items = [item for item in files if item['path'].startswith('attachments/' + label + '/')]
        attachments[label] = {'files': len(items), 'bytes': sum(item['bytes'] for item in items)}
    return {'captured_at': manifest['captured_at'], 'verified_files': len(files), 'bytes': sum(item['bytes'] for item in files), 'databases': results, 'attachments': attachments, 'legacy_copies_identical': legacy == original, 'archive_bytes': archive.stat().st_size, 'archive_sha256': digest(archive)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--archive-sha256', help='Optional capture receipt digest, from outside the archive')
    args = parser.parse_args()
    main_root = main_checkout()
    base = (main_root / args.snapshot).resolve()
    if main_root / '.tools' / 'forum-migration' not in base.parents:
        raise ValueError('CLI only accepts this project private capture directory')
    relative = str(base.relative_to(main_root))
    if subprocess.run(['git', 'check-ignore', '-q', relative + '/source/forum.sqlite'], cwd=main_root).returncode:
        raise ValueError('Private backup must be ignored by Git')
    if subprocess.check_output(['git', 'ls-files', '--', relative], cwd=main_root, text=True).strip():
        raise ValueError('Private backup is tracked by Git')
    result = verify_snapshot(base)
    if args.archive_sha256 and result['archive_sha256'] != args.archive_sha256:
        raise ValueError('Archive differs from original capture receipt')
    print(json.dumps({'snapshot': relative, 'git_ignored': True, **result}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
