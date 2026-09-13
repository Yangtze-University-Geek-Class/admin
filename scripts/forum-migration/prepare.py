#!/usr/bin/env python3
"""Build a private, read-only forum content projection from a verified capture.

The current forum database is authoritative. Deleted/hidden rows are NOT
resurrected from older mbbs copies. Credentials, sessions, email, IPs, private
notifications and group grants never enter the projection. No source is edited.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
from urllib.parse import unquote, urlsplit
from verify import verify_snapshot, ROOT


def dump(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def rows(db, table, columns):
    return [dict(row) for row in db.execute('SELECT ' + ','.join(columns) + ' FROM ' + table + ' ORDER BY id')]


def visible_categories(categories):
    by_id = {c['id']: c for c in categories}
    def visible(category, seen=None):
        seen = set() if seen is None else seen
        if category['id'] in seen:
            raise ValueError('Category ancestry cycle')
        if category.get('hidden'):
            return False
        parent = category.get('parent_id')
        if parent is None:
            return True
        return parent in by_id and visible(by_id[parent], seen | {category['id']})
    return [c for c in categories if visible(c)]


def project(db, aliases, captured_at):
    categories = rows(db, 'forum_categories', ['id','slug','name','description','color','parent_id','hidden','is_legacy','legacy_mbbs_id'])
    users = rows(db, 'forum_users', ['id','username','display_name','bio','signature','avatar_url','role','created_at'])
    threads = rows(db, 'forum_threads', ['id','category_id','user_id','title','content','content_format','view_count','is_sticky','is_locked','is_deleted','legacy_mbbs_id','created_at','updated_at','last_posted_at'])
    replies = rows(db, 'forum_posts', ['id','thread_id','user_id','reply_post_id','content','content_format','is_deleted','legacy_mbbs_id','created_at','updated_at'])
    categories = visible_categories(categories)
    cats = {c['id']: c for c in categories}
    live_threads = [t for t in threads if not t['is_deleted'] and t['category_id'] in cats]
    by_thread = {t['id']: t for t in live_threads}
    live_replies = [p for p in replies if not p['is_deleted'] and p['thread_id'] in by_thread]
    by_reply = {p['id']: p for p in live_replies}
    legacy_threads = {str(t['legacy_mbbs_id']): f"/t/t{t['id']}" for t in live_threads if t['legacy_mbbs_id'] is not None}
    legacy_categories = {str(c['legacy_mbbs_id']): '/c/' + c['slug'] for c in categories if c['legacy_mbbs_id'] is not None}
    used_assets, missing_assets = set(), set()
    def asset_name(url):
        parsed = urlsplit(url)
        if parsed.netloc and parsed.hostname not in {'yangtzeu.work','forum.yangtzeu.work','prev.yangtzeu.work'}:
            return None
        path = unquote(parsed.path)
        if path.startswith('/forum/r/'):
            return 'legacy/' + path[len('/forum/r/'):]
        if path.startswith('bbs/') or path.startswith('/bbs/'):
            return 'legacy/' + path.lstrip('/')
        if path.startswith('/forum/u/'):
            return 'uploads/' + path[len('/forum/u/'):]
        return None
    def rewrite_url(url):
        name = asset_name(url)
        if name is not None:
            key = aliases.get(name)
            if key:
                used_assets.add(key)
                return '/api/local-forum/assets/' + key
            missing_assets.add(name)
            return '#attachment-unavailable'
        try:
            parsed = urlsplit(url)
        except ValueError:
            return '#invalid-link'
        if parsed.netloc and parsed.hostname not in {'yangtzeu.work','forum.yangtzeu.work','prev.yangtzeu.work'}:
            return url
        old = re.fullmatch(r'/?thread/detail/(\d+)', parsed.fragment)
        if old:
            return legacy_threads.get(old[1], '#legacy-content-unavailable')
        old_cat = re.fullmatch(r'/?thread/category/(\d+)', parsed.fragment)
        if old_cat:
            return legacy_categories.get(old_cat[1], '#legacy-content-unavailable')
        target = re.fullmatch(r'/(?:forum/)?(?:archive/)?t/(\d+)', parsed.path)
        if target:
            return f'/t/t{target[1]}' if int(target[1]) in by_thread else '#legacy-content-unavailable'
        cat = re.fullmatch(r'/forum/c/(.+)', parsed.path)
        if cat:
            return '/c/' + cat[1]
        if parsed.path in {'/forum/archive','/forum/categories'}:
            from urllib.parse import parse_qs
            slug = parse_qs(parsed.query).get('category', [None])[0]
            return '/c/' + slug if slug and any(c['slug'] == slug for c in categories) else '/categories'
        return url
    def content(text):
        # Leave fenced code examples unchanged. Rewrite destinations, never source metadata.
        result, fence = [], None
        for line in (text or '').splitlines(keepends=True):
            mark = re.match(r'^\s*(`{3,}|~{3,})', line)
            if mark:
                if fence is None: fence = mark[1]
                elif mark[1][0] == fence[0] and len(mark[1]) >= len(fence): fence = None
                result.append(line); continue
            if fence is None:
                line = re.sub(r'(!?\[[^\]\n]*\]\()([^\s)]+)', lambda m: m[1] + rewrite_url(m[2]), line)
                line = re.sub(r'((?:src|href)\s*=\s*["\'])([^"\']+)', lambda m: m[1] + rewrite_url(m[2]), line, flags=re.I)
                line = re.sub(r'https?://(?:forum\.)?yangtzeu\.work/(?:\#/thread/(?:detail|category)/\d+|forum/(?:archive/)?t/\d+)', lambda m: rewrite_url(m[0]), line)
            result.append(line)
        return ''.join(result)
    def color(value):
        return value if re.fullmatch(r'#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?', value or '') else '#4361b5'
    def timestamp(value):
        return max(0, int(value or 0))
    # Preserve public attribution only. Unsafe/ambiguous handles receive a stable route handle.
    used_handles = set()
    public_users = []
    for user in users:
        handle = user['username'] or f"member-{user['id']}"
        if not re.fullmatch(r'[\w.-]{1,64}', handle) or handle.lower() in used_handles:
            handle = f"member-{user['id']}"
        used_handles.add(handle.lower())
        avatar = rewrite_url(user['avatar_url']) if user['avatar_url'] and asset_name(user['avatar_url']) else None
        public_users.append({'id':f"u{user['id']}", 'username':handle, 'displayName':user['display_name'] or user['username'] or '历史成员', 'bio':user['bio'] or user['signature'] or '', 'location':'', 'website':'', 'avatarColor':'#4361b5', 'avatarUrl':avatar, 'joinedAt':timestamp(user['created_at']), 'role':{'admin':'admin','mod':'moderator'}.get(user['role'],'member'), 'notifyPrefs':{'reply':False,'like':False,'follow':False}})
    user_ids = {u['id'] for u in public_users}
    topics, posts = [], []
    for t in live_threads:
        author = f"u{t['user_id']}"
        if author not in user_ids: raise ValueError('Unresolved topic author')
        archived = bool(cats[t['category_id']]['is_legacy'])
        topics.append({'id':f"t{t['id']}", 'slug':f"topic-{t['id']}", 'title':t['title'], 'categoryId':f"c{t['category_id']}", 'tagIds':[], 'authorId':author, 'createdAt':timestamp(t['created_at']), 'lastActivityAt':timestamp(t['last_posted_at'] or t['updated_at'] or t['created_at']), 'views':int(t['view_count'] or 0), 'pinned':bool(t['is_sticky']), 'closed':bool(t['is_locked']), 'archived':archived})
        posts.append({'id':f"body-{t['id']}", 'topicId':f"t{t['id']}", 'authorId':author, 'content':content(t['content']), 'createdAt':timestamp(t['created_at']), 'editedAt':timestamp(t['updated_at']) if t['updated_at'] != t['created_at'] else None, 'isTopicBody':True, 'likeUserIds':[]})
    for p in live_replies:
        author = f"u{p['user_id']}"
        if author not in user_ids: raise ValueError('Unresolved reply author')
        entry = {'id':f"p{p['id']}", 'topicId':f"t{p['thread_id']}", 'authorId':author, 'content':content(p['content']), 'createdAt':timestamp(p['created_at']), 'likeUserIds':[]}
        if p['updated_at'] != p['created_at']: entry['editedAt'] = timestamp(p['updated_at'])
        target = by_reply.get(p['reply_post_id'])
        if target and target['thread_id'] == p['thread_id']: entry['replyToPostId'] = f"p{target['id']}"
        posts.append(entry)
    post_ids = {p['id']:p for p in posts}
    for row in db.execute('SELECT user_id,post_id FROM forum_likes'):
        uid, pid = f"u{row['user_id']}", f"p{row['post_id']}"
        if uid in user_ids and pid in post_ids and uid not in post_ids[pid]['likeUserIds']: post_ids[pid]['likeUserIds'].append(uid)
    tags = rows(db, 'forum_tags', ['id','slug','name','color'])
    public_tags = [{'id':f"tag{t['id']}", 'slug':t['slug'], 'name':t['name'], 'color':color(t['color'])} for t in tags]
    topic_index = {t['id']:t for t in topics}; tag_ids = {t['id'] for t in public_tags}
    for row in db.execute('SELECT thread_id,tag_id FROM forum_thread_tags'):
        tid, tagid = f"t{row['thread_id']}", f"tag{row['tag_id']}"
        if tid in topic_index and tagid in tag_ids: topic_index[tid]['tagIds'].append(tagid)
    state = {'version':1, 'seededAt':0, 'counters':{'topic':max([t['id'] for t in threads],default=0),'post':max([p['id'] for p in replies],default=0),'notification':0,'tag':max([t['id'] for t in tags],default=0)}, 'users':public_users, 'categories':[{'id':f"c{c['id']}",'slug':c['slug'],'name':c['name'],'description':c['description'] or '', 'color':color(c['color']),'icon':'i-carbon-archive' if c['is_legacy'] else 'i-carbon-forum','archived':bool(c['is_legacy'])} for c in categories], 'tags':public_tags, 'topics':topics, 'posts':posts, 'notifications':[], 'bookmarks':[], 'follows':[]}
    return {'schemaVersion':1,'mode':'local-snapshot','capturedAt':captured_at,'state':state,'legacyLinks':{'threads':legacy_threads,'categories':legacy_categories},'summary':{'users':len(public_users),'topics':len(topics),'replies':len(live_replies),'categories':len(categories),'archivedTopics':sum(t['archived'] for t in topics),'excludedDeletedTopics':sum(bool(t['is_deleted']) for t in threads),'excludedDeletedReplies':sum(bool(p['is_deleted']) for p in replies),'missingAttachments':len(missing_assets)}}, used_assets, sorted(missing_assets)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',required=True)
    parser.add_argument('--archive-sha256',required=True)
    parser.add_argument('--name',required=True)
    parser.add_argument('--node',required=True,help='Project Node 22 for installed sharp ABI')
    args=parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', args.name): raise ValueError('Invalid projection name')
    snapshot=Path(args.snapshot).resolve()
    if ROOT/'.tools/forum-migration' not in snapshot.parents: raise ValueError('Private capture required')
    receipt=verify_snapshot(snapshot)
    if receipt['archive_sha256']!=args.archive_sha256: raise ValueError('Capture receipt digest mismatch')
    os.umask(0o077)
    target=ROOT/'.tools/forum-runtime'/args.name
    target.mkdir(parents=True,exist_ok=False,mode=0o700)
    source=snapshot/'source'
    manifest=json.loads((source/'manifest.json').read_text())
    files=[]
    for item in manifest['files']:
        if item['path'].startswith(('attachments/legacy/','attachments/uploads/')):
            files.append({'name':item['path'][len('attachments/'):], 'source':str(source/item['path']), 'sha256':item['sha256']})
    dump(target/'asset-job.json',{'files':files})
    subprocess.run([args.node,str(ROOT/'scripts/forum-migration/normalize-assets.mjs'),str(target/'asset-job.json')],check=True,timeout=180)
    assets=json.loads((target/'asset-index.json').read_text())
    db=sqlite3.connect((source/'forum.sqlite').as_uri()+'?mode=ro&immutable=1',uri=True);db.row_factory=sqlite3.Row
    try: payload, used, missing=project(db,assets['aliases'],manifest['captured_at'])
    finally: db.close()
    dump(target/'content.json',payload)
    content_hash=hashlib.sha256((target/'content.json').read_bytes()).hexdigest()
    dump(target/'manifest.json',{'schemaVersion':1,'sourceArchiveSha256':receipt['archive_sha256'],'contentSha256':content_hash,'assets':{key:assets['assets'][key] for key in sorted(used)},'summary':payload['summary']})
    dump(target/'conversion-report.json',{'summary':payload['summary'],'sourceReceipt':receipt,'referencedAssets':len(used),'missingAttachments':missing,'rejectedAssets':assets['rejected'],'sourceAuthoritative':'forum.sqlite; mbbs originals retained, not used to resurrect deleted content'})
    print(json.dumps({'directory':str(target.relative_to(ROOT)),'contentSha256':content_hash,'summary':payload['summary'],'referencedAssets':len(used),'missingAttachments':len(missing)},ensure_ascii=False))


if __name__=='__main__': main()
