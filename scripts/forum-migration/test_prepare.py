import json
import sqlite3
import unittest
from prepare import project, visible_categories


class ProjectionTests(unittest.TestCase):
    def fixture(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        def table(name, definitions, values=()):
            db.execute('CREATE TABLE ' + name + '(' + definitions + ')')
            for value in values:
                columns = list(value)
                db.execute('INSERT INTO ' + name + '(' + ','.join(columns) + ') VALUES(' + ','.join('?' for _ in columns) + ')', [value[c] for c in columns])
        table('forum_users', 'id INTEGER,username TEXT,display_name TEXT,bio TEXT,signature TEXT,avatar_url TEXT,role TEXT,created_at INTEGER,password_bcrypt TEXT,email TEXT', [dict(id=1,username='fixture',display_name='虚构成员',role='member',created_at=100,password_bcrypt='never-export-this',email='private@example.invalid')])
        table('forum_categories', 'id INTEGER,slug TEXT,name TEXT,description TEXT,color TEXT,parent_id INTEGER,hidden INTEGER,is_legacy INTEGER,legacy_mbbs_id INTEGER', [dict(id=1,slug='fixture',name='测试分类',hidden=0,is_legacy=1,legacy_mbbs_id=10)])
        table('forum_threads', 'id INTEGER,category_id INTEGER,user_id INTEGER,title TEXT,content TEXT,content_format TEXT,view_count INTEGER,is_sticky INTEGER,is_locked INTEGER,is_deleted INTEGER,legacy_mbbs_id INTEGER,created_at INTEGER,updated_at INTEGER,last_posted_at INTEGER', [dict(id=1,category_id=1,user_id=1,title='有效主题',content='![图片](bbs/test.png)\n[旧链接](https://yangtzeu.work/#/thread/detail/11)',content_format='markdown',view_count=3,is_sticky=0,is_locked=0,is_deleted=0,legacy_mbbs_id=11,created_at=100,updated_at=100),dict(id=2,category_id=1,user_id=1,title='不应复活',content='deleted-secret',is_deleted=1,created_at=100)])
        table('forum_posts', 'id INTEGER,thread_id INTEGER,user_id INTEGER,reply_post_id INTEGER,content TEXT,content_format TEXT,is_deleted INTEGER,legacy_mbbs_id INTEGER,created_at INTEGER,updated_at INTEGER', [dict(id=1,thread_id=1,user_id=1,content='保留回复',is_deleted=0,created_at=200,updated_at=200),dict(id=2,thread_id=1,user_id=1,content='deleted-reply-secret',is_deleted=1,created_at=300,updated_at=300)])
        table('forum_tags','id INTEGER,slug TEXT,name TEXT,color TEXT')
        table('forum_thread_tags','thread_id INTEGER,tag_id INTEGER')
        table('forum_likes','user_id INTEGER,post_id INTEGER')
        return db

    def test_public_projection_does_not_export_credentials_or_deleted_content(self):
        payload, used, missing = project(self.fixture(), {'legacy/bbs/test.png':'a'*64}, '2026-09-13T00:00:00Z')
        self.assertEqual(payload['summary']['topics'],1)
        self.assertEqual(payload['summary']['replies'],1)
        self.assertEqual(payload['summary']['excludedDeletedTopics'],1)
        self.assertEqual(payload['summary']['excludedDeletedReplies'],1)
        text=json.dumps(payload)
        for private in ['never-export-this','private@example.invalid','deleted-secret','deleted-reply-secret','password_bcrypt']:
            self.assertNotIn(private,text)
        self.assertEqual(payload['state']['notifications'],[])
        self.assertIn('(/t/t1)', payload['state']['posts'][0]['content'])
        self.assertEqual(used, {'a'*64})
        self.assertEqual(missing, [])

    def test_hidden_ancestor_hides_children_and_content(self):
        db=self.fixture()
        db.execute("INSERT INTO forum_categories(id,slug,name,hidden) VALUES(9,'hidden','隐藏父分类',1)")
        db.execute('UPDATE forum_categories SET parent_id=9 WHERE id=1')
        payload, _, _=project(db,{},'2026-09-13T00:00:00Z')
        self.assertEqual(payload['state']['categories'],[])
        self.assertEqual(payload['state']['topics'],[])
        self.assertEqual(payload['state']['posts'],[])

    def test_category_cycle_is_an_error_not_a_public_fallback(self):
        with self.assertRaises(ValueError):
            visible_categories([{'id':1,'parent_id':2},{'id':2,'parent_id':1}])

    def test_missing_attachment_is_recorded_not_a_live_remote_request(self):
        payload, _, missing=project(self.fixture(),{},'2026-09-13T00:00:00Z')
        self.assertEqual(missing,['legacy/bbs/test.png'])
        self.assertIn('#attachment-unavailable',payload['state']['posts'][0]['content'])


if __name__=='__main__': unittest.main()
