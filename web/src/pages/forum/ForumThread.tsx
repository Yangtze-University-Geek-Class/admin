import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, fmtDate, fmtRelative } from "../../lib/api";
import { renderPostContent } from "../../lib/forum-render";
import { useConfirm } from "../../components/ConfirmDialog";
import { Avatar } from "./ForumLayout";

type Author = { id: number; username: string; display_name: string | null; avatar_url: string | null; role: string; signature: string | null };
type Thread = {
  id: number; title: string; content: string; content_format: string;
  view_count: number; reply_count: number; is_sticky: number; is_essence: number; is_locked: number;
  created_at: number; updated_at: number; last_posted_at: number;
  author: Author;
  category: { slug: string; name: string };
};
type Post = {
  id: number; content: string; content_format: string; like_count: number; liked: boolean;
  reply_post_id: number | null; created_at: number;
  author: Author;
};
type Me = { signed_in: boolean; user?: { id: number; username: string; role: string } };

export default function ForumThread() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const me = useQuery({ queryKey: ["forum-me"], queryFn: () => api<Me>("/api/me") });
  const detail = useQuery({
    queryKey: ["forum-thread", id],
    enabled: Boolean(id),
    queryFn: () => api<{ thread: Thread; posts: Post[]; page: number; page_size: number }>(`/api/forum/threads/${id}`),
  });
  const [replyText, setReplyText] = useState("");
  const [replyTo, setReplyTo] = useState<{ post_id: number; author: string } | null>(null);

  const submitReply = useMutation({
    mutationFn: () => api(`/api/forum/posts`, { method: "POST", body: JSON.stringify({ thread_id: Number(id), content: replyText, reply_post_id: replyTo?.post_id ?? null, content_format: "markdown" }) }),
    onSuccess: () => { setReplyText(""); setReplyTo(null); qc.invalidateQueries({ queryKey: ["forum-thread", id] }); },
  });
  const toggleLike = useMutation({
    mutationFn: (postId: number) => api(`/api/forum/posts/${postId}/like`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum-thread", id] }),
  });
  const deleteThread = useMutation({
    mutationFn: () => api(`/api/forum/threads/${id}`, { method: "DELETE" }),
    onSuccess: () => nav("/"),
  });
  const deletePost = useMutation({
    mutationFn: (postId: number) => api(`/api/forum/posts/${postId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum-thread", id] }),
  });
  const patchThread = useMutation({
    mutationFn: (patch: Record<string, number>) => api(`/api/forum/threads/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum-thread", id] }),
  });

  const t = detail.data?.thread;
  const posts = detail.data?.posts ?? [];
  const u = me.data?.user;
  const isMod = u?.role === "admin" || u?.role === "mod";
  const canManageThread = Boolean(u && t && (u.id === t.author.id || isMod));

  const threadHtml = useMemo(() => t ? renderPostContent(t.content, t.content_format) : "", [t?.content, t?.content_format]);

  if (detail.isLoading) return <div className="max-w-4xl mx-auto px-6 py-12 text-ink-400">加载中…</div>;
  if (detail.error) return <div className="max-w-4xl mx-auto px-6 py-12 text-rose-500">{(detail.error as Error).message}</div>;
  if (!t) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <nav className="text-sm text-ink-400 mb-3">
        <Link to="/" className="hover:text-brand-500">论坛</Link>
        <span className="mx-2">/</span>
        <Link to={`/c/${encodeURIComponent(t.category.slug)}`} className="hover:text-brand-500">{t.category.name}</Link>
      </nav>

      <div className="card p-6 mb-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {t.is_sticky ? <span className="tag-blue text-[10px]">置顶</span> : null}
              {t.is_essence ? <span className="tag-yellow text-[10px]">精华</span> : null}
              {t.is_locked ? <span className="tag-gray text-[10px]">已锁</span> : null}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-ink-50 mt-1 leading-snug">{t.title}</h1>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isMod && (
              <>
                <button onClick={() => patchThread.mutate({ is_sticky: t.is_sticky ? 0 : 1 })}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition ${t.is_sticky ? "bg-brand-500/15 border-brand-500/40 text-brand-500" : "border-ink-700/60 text-ink-300 hover:bg-ink-800/60"}`}
                  title="置顶">{t.is_sticky ? "已置顶" : "置顶"}</button>
                <button onClick={() => patchThread.mutate({ is_essence: t.is_essence ? 0 : 1 })}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition ${t.is_essence ? "bg-amber-500/15 border-amber-500/40 text-amber-500" : "border-ink-700/60 text-ink-300 hover:bg-ink-800/60"}`}
                  title="加精">{t.is_essence ? "已加精" : "加精"}</button>
                <button onClick={() => patchThread.mutate({ is_locked: t.is_locked ? 0 : 1 })}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition ${t.is_locked ? "bg-rose-500/15 border-rose-500/40 text-rose-500" : "border-ink-700/60 text-ink-300 hover:bg-ink-800/60"}`}
                  title="锁定">{t.is_locked ? "已锁定" : "锁定"}</button>
              </>
            )}
            {canManageThread && (
              <button onClick={async () => {
                const ok = await confirm({ title: "删除主题", body: `确认删除「${t.title}」？回帖会一并隐藏。`, confirmText: "删除", variant: "danger" });
                if (ok) deleteThread.mutate();
              }} className="btn-danger text-xs px-3 py-1.5">删除</button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm pb-4 border-b border-brand-500/10">
          <Avatar user={t.author} size={36} />
          <div className="flex-1">
            <Link to={`/u/${t.author.username}`} className="text-ink-50 font-medium hover:text-brand-500">{t.author.display_name ?? t.author.username}</Link>
            {t.author.role === "admin" && <span className="ml-2 tag-blue text-[10px]">admin</span>}
            <div className="text-xs text-ink-400 mt-0.5">{fmtDate(t.created_at)} · 阅读 {t.view_count}</div>
          </div>
        </div>
        <article className="prose-forum mt-5" dangerouslySetInnerHTML={{ __html: threadHtml }} />
      </div>

      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-base font-semibold text-ink-50">{t.reply_count} 条回复</h2>
        {u && !t.is_locked && (
          <a href="#reply-box" className="text-sm text-brand-500 hover:underline">↓ 回复</a>
        )}
      </div>

      <div className="space-y-3">
        {posts.map((p, idx) => {
          const html = renderPostContent(p.content, p.content_format);
          const canDel = u && (u.id === p.author.id || u.role === "admin" || u.role === "mod");
          return (
            <div key={p.id} className="card p-5">
              <div className="flex items-start gap-3 mb-3">
                <Avatar user={p.author} size={32} />
                <div className="flex-1">
                  <Link to={`/u/${p.author.username}`} className="text-ink-100 text-sm font-medium hover:text-brand-500">{p.author.display_name ?? p.author.username}</Link>
                  {p.author.role === "admin" && <span className="ml-2 tag-blue text-[10px]">admin</span>}
                  <div className="text-xs text-ink-400">#{idx + 2} · {fmtRelative(p.created_at)}</div>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {u && (
                    <button onClick={() => toggleLike.mutate(p.id)} className={`px-2 py-1 rounded transition ${p.liked ? "bg-brand-500/15 text-brand-500" : "text-ink-400 hover:bg-brand-500/8 hover:text-brand-500"}`}>
                      ♥ {p.like_count}
                    </button>
                  )}
                  {u && !t.is_locked && <button onClick={() => { setReplyTo({ post_id: p.id, author: p.author.display_name ?? p.author.username }); document.getElementById("reply-box")?.scrollIntoView({ behavior: "smooth" }); }} className="px-2 py-1 rounded text-ink-400 hover:bg-brand-500/8 hover:text-brand-500 transition">回复</button>}
                  {canDel && (
                    <button onClick={async () => {
                      const ok = await confirm({ title: "删除回帖", body: "确认删除这条回复？", confirmText: "删除", variant: "danger" });
                      if (ok) deletePost.mutate(p.id);
                    }} className="px-2 py-1 rounded text-ink-400 hover:bg-rose-500/10 hover:text-rose-500 transition">删除</button>
                  )}
                </div>
              </div>
              <article className="prose-forum text-[15px]" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          );
        })}
        {posts.length === 0 && <div className="card p-8 text-center text-ink-300 text-sm">还没有回复</div>}
      </div>

      <div id="reply-box" className="mt-8 card p-5">
        {!u && (
          <div className="text-center text-ink-300 py-6 text-sm">
            <Link to={`/login?return_to=/t/${id}`} className="text-brand-500 hover:underline">登录</Link>
            {" 或 "}
            <Link to={`/register?return_to=/t/${id}`} className="text-brand-500 hover:underline">注册</Link>
            {" 后即可回帖"}
          </div>
        )}
        {u && t.is_locked && (
          <div className="text-center text-ink-300 py-4 text-sm">该主题已锁定，无法回复</div>
        )}
        {u && !t.is_locked && (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-ink-300">回复 · Markdown 支持</div>
              {replyTo && (
                <div className="text-xs text-ink-400 flex items-center gap-2">
                  回复 <span className="text-brand-500">@{replyTo.author}</span>
                  <button onClick={() => setReplyTo(null)} className="text-ink-400 hover:text-rose-500">×</button>
                </div>
              )}
            </div>
            <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={6}
              placeholder={replyTo ? `回复 @${replyTo.author}…` : "写下你的回复，支持 Markdown…"}
              className="input font-mono text-sm w-full resize-y" />
            <div className="flex items-center justify-end gap-2 mt-3">
              {submitReply.error && <div className="text-rose-500 text-xs mr-auto">{(submitReply.error as Error).message}</div>}
              <button onClick={() => submitReply.mutate()} disabled={!replyText.trim() || submitReply.isPending}
                className="btn-primary text-sm px-5 py-2 disabled:opacity-50">
                {submitReply.isPending ? "提交中…" : "发布回复"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
