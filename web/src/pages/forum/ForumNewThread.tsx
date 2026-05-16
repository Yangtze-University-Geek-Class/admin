import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import Select from "../../components/Select";

type Category = { id: number; slug: string; name: string; parent_id: number | null };
type Me = { signed_in: boolean; user?: { id: number; username: string } };

export default function ForumNewThread() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const me = useQuery({ queryKey: ["forum-me"], queryFn: () => api<Me>("/api/me") });
  const cats = useQuery({ queryKey: ["forum-categories"], queryFn: () => api<{ categories: Category[] }>("/api/forum/categories") });

  const [categoryId, setCategoryId] = useState<string>(params.get("category") ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const submit = useMutation({
    mutationFn: () => api<{ ok: boolean; id: number }>(
      `/api/forum/threads`,
      { method: "POST", body: JSON.stringify({ category_id: Number(categoryId), title, content, content_format: "markdown" }) },
    ),
    onSuccess: (r) => nav(`/t/${r.id}`),
  });

  if (me.isLoading) return <div className="max-w-3xl mx-auto px-6 py-12 text-ink-400">…</div>;
  if (!me.data?.user) {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="card p-8">
          <h1 className="text-lg font-semibold text-ink-50 mb-3">需要登录</h1>
          <p className="text-ink-300 text-sm mb-5">发帖前请先登录</p>
          <Link to="/login?return_to=/new" className="btn-primary text-sm px-5 py-2">去登录</Link>
        </div>
      </div>
    );
  }

  const opts = (cats.data?.categories ?? []).filter((c) => c.parent_id !== null || !cats.data?.categories.some((x) => x.parent_id === c.id))
    .map((c) => ({ value: String(c.id), label: c.name, hint: c.slug }));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <nav className="text-sm text-ink-400 mb-3">
        <Link to="/" className="hover:text-brand-500">论坛</Link>
        <span className="mx-2">/</span>
        <span className="text-ink-100">发帖</span>
      </nav>
      <h1 className="text-2xl font-bold text-ink-50 mb-5">发布主题</h1>
      <div className="card p-6 space-y-4">
        <div>
          <label className="label text-sm">分类</label>
          <Select value={categoryId} onChange={setCategoryId}
            options={[{ value: "", label: "— 选择一个分类 —" }, ...opts]} />
        </div>
        <div>
          <label className="label text-sm">标题</label>
          <input className="input" maxLength={200} placeholder="写一个一句话能讲清楚的标题"
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="text-xs text-ink-400 mt-1 text-right">{title.length}/200</div>
        </div>
        <div>
          <label className="label text-sm">正文 · Markdown</label>
          <textarea rows={16} className="input font-mono text-sm resize-y w-full"
            placeholder={"# 一级标题\n\n正文..."}
            value={content} onChange={(e) => setContent(e.target.value)} />
        </div>
        {submit.error && <div className="text-rose-500 text-sm">{(submit.error as Error).message}</div>}
        <div className="flex items-center justify-end gap-3">
          <Link to="/" className="btn-ghost text-sm px-4 py-2">取消</Link>
          <button disabled={!categoryId || !title.trim() || !content.trim() || submit.isPending}
            onClick={() => submit.mutate()}
            className="btn-primary text-sm px-5 py-2 disabled:opacity-50">
            {submit.isPending ? "发布中…" : "发布"}
          </button>
        </div>
      </div>
    </div>
  );
}
