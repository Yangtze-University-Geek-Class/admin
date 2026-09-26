"""Synthetic-only capture checks. Never opens the real backup or contacts SSH."""
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest

from capture import extract_verified, ssh_argv
from verify import digest, main_checkout, verify_snapshot


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='geek-capture-fixture-')
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def fixture(self):
        db_path = self.root / 'synthetic.sqlite'
        db = sqlite3.connect(db_path)
        db.execute('CREATE TABLE synthetic_items(id INTEGER PRIMARY KEY, title TEXT)')
        db.execute("INSERT INTO synthetic_items VALUES(1, 'fictional record')")
        db.commit()
        db.close()
        data = {'forum.sqlite': db_path.read_bytes(), 'attachments/legacy/example.txt': b'fictional attachment'}
        manifest = {
            'schema_version': 1, 'method': 'sqlite-online-backup', 'captured_at': '2026-01-01T00:00:00Z',
            'databases': {'forum': {'tables': {'synthetic_items': 1}}},
            'files': [{'path': name, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()} for name, body in data.items()],
        }
        data['manifest.json'] = json.dumps(manifest).encode()
        self.write_archive(data)
        extract_verified(self.root / 'transfer.tar.gz', self.root / 'source')
        return manifest

    def write_archive(self, data):
        with tarfile.open(self.root / 'transfer.tar.gz', 'w:gz') as archive:
            for name, body in data.items():
                info = tarfile.TarInfo(name)
                info.size = len(body)
                info.mode = 0o600
                archive.addfile(info, io.BytesIO(body))

    def test_full_restore_and_hashes_without_mutating_source(self):
        self.fixture()
        before = digest(self.root / 'source/forum.sqlite')
        result = verify_snapshot(self.root)
        self.assertEqual(result['verified_files'], 2)
        self.assertTrue(result['databases']['forum']['restored_counts_match'])
        self.assertEqual(result['databases']['forum']['integrity_check'], 'ok')
        self.assertEqual(before, digest(self.root / 'source/forum.sqlite'))

    def test_changed_payload_fails(self):
        self.fixture()
        (self.root / 'source/attachments/legacy/example.txt').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash or size'):
            verify_snapshot(self.root)

    def test_payload_and_manifest_cannot_be_changed_together(self):
        manifest = self.fixture()
        body = b'coordinated local edit'
        (self.root / 'source/attachments/legacy/example.txt').write_bytes(body)
        manifest['files'][1].update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
        (self.root / 'source/manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'differs from captured archive'):
            verify_snapshot(self.root)

    def test_traversal_never_writes_outside_destination(self):
        self.write_archive({'../outside.txt': b'unsafe'})
        with self.assertRaisesRegex(ValueError, 'Unsafe archive'):
            extract_verified(self.root / 'transfer.tar.gz', self.root / 'source')
        self.assertFalse((self.root / 'outside.txt').exists())

    def test_symlink_member_is_rejected(self):
        with tarfile.open(self.root / 'transfer.tar.gz', 'w:gz') as archive:
            info = tarfile.TarInfo('link')
            info.type = tarfile.SYMTYPE
            info.linkname = '../outside.txt'
            archive.addfile(info)
        with self.assertRaisesRegex(ValueError, 'Unsafe archive'):
            extract_verified(self.root / 'transfer.tar.gz', self.root / 'source')

    def test_public_read_permissions_are_rejected(self):
        self.fixture()
        (self.root / 'source/forum.sqlite').chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'permissions'):
            verify_snapshot(self.root)

    def test_unexpected_extracted_file_is_rejected(self):
        self.fixture()
        (self.root / 'source/unexpected.txt').write_text('fictional extra file')
        with self.assertRaisesRegex(ValueError, 'Unexpected file'):
            verify_snapshot(self.root)

    def test_ssh_call_is_strict_and_binds_only_a_named_interface(self):
        plain = ssh_argv('root@203.0.113.9', 2200, 'true')
        self.assertEqual(plain[:2], ['/usr/bin/ssh', '-T'])
        self.assertIn('StrictHostKeyChecking=yes', plain)
        self.assertEqual(plain[-3:], ['2200', 'root@203.0.113.9', 'true'])
        self.assertFalse(any(item.startswith('BindInterface') for item in plain))
        bound = ssh_argv('root@203.0.113.9', 2200, 'true', 'en0')
        self.assertEqual(bound[bound.index('BindInterface=en0') - 1], '-o')
        self.assertLess(bound.index('BindInterface=en0'), bound.index('root@203.0.113.9'))
        for bad in ['en0 -oProxyCommand=x', '-en0', 'EN0', '']:
            with self.assertRaisesRegex(ValueError, 'interface'):
                ssh_argv('root@203.0.113.9', 2200, 'true', bad)
        with self.assertRaisesRegex(ValueError, 'SSH target'):
            ssh_argv('-oProxyCommand=x', 2200, 'true')

    def test_private_data_belongs_to_the_main_checkout_of_a_worktree(self):
        repo = self.root / 'repo'
        run = lambda *args, cwd=repo: subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True)
        repo.mkdir()
        run('init', '-q')
        run('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture')
        run('worktree', 'add', '-q', str(self.root / 'task'))
        self.assertEqual(main_checkout(repo).resolve(), repo.resolve())
        self.assertEqual(main_checkout(self.root / 'task').resolve(), repo.resolve())


if __name__ == '__main__':
    unittest.main()
