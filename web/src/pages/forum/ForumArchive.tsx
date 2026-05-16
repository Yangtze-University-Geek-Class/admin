import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fmtRelative } from "../../lib/api";
import { Avatar } from "./ForumLayout";

type Category = { id: number; slug: string; name: string; description: string | null; parent_id: number | null; thread_count: number };
type ThreadItem = {
  id: number; title: string; reply_count: number; view_count: number;
  is_sticky: number; is_essence: number; last_posted_at: number; created_at: number;
  author: { id: number; username: string; display_name: string | null; avatar_url: string | null; role: string };
  category: { slug: string; name: string };
};

export default function ForumArchive() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const category = params.get("category") ?? undefined;

  const cats = useQuery({ queryKey: ["forum-archive-categories"], queryFn: () => api<{ categories: Category[] }>("/api/forum/archive/categories") });
  const list = useQuery({
    queryKey: ["forum-archive-threads", { category, page }],
    queryFn: () => api<{ threads: ThreadItem[]; total: number; page: number; page_size: number }>(
      `/api/forum/threads?${new URLSearchParams({ archive: "1", ...(category ? { category } : {}), page: String(page) }).toString()}`,
    ),
  });

  const roots = (cats.data?.categories ?? []).filter((c) => !c.parent_id);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[1fr_280px] gap-8">
      <main>
        <div className="card p-5 mb-5 border-amber-500/40 bg-amber-500/5">
          <div className="text-amber-600 dark:text-amber-400 font-semibold text-sm mb-1">老论坛归档</div>
          <p className="text-ink-300 text-sm leading-relaxed">
            这里保留 mbbs 老论坛的全部主题和回帖，{cats.data?.categories.length ?? 0} 个老分类。仅供阅读，不能发帖、回帖、点赞。
            新讨论请去 <Link to="/" className="text-brand-500 hover:underline">新论坛</Link>。
          </p>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-xl font-bold text-ink-50">
            {category ? cats.data?.categories.find((c) => c.slug === category)?.name : "全部老帖"}
          </h1>
          {category && (
            <button onClick={() => { params.delete("category"); params.delete("page"); setParams(params); }}
              className="text-xs text-brand-500 hover:underline">清除分类筛选</button>
          )}
        </div>

        {list.isLoading && <div className="text-ink-400">加载中…</div>}
        {list.data?.threads.length === 0 && <div className="card p-10 text-center text-ink-300">这个分类下没有归档</div>}

        <div className="card overflow-hidden divide-y divide-brand-500/10">
          {list.data?.threads.map((t) => (
            <Link key={t.id} to={`/archive/t/${t.id}`} className="block p-4 hover:bg-brand-500/5 transition">
              <div className="flex gap-3">
                <Avatar user={t.author} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.is_sticky ? <span className="tag-blue text-[10px]">置顶</span> : null}
                    {t.is_essence ? <span className="tag-yellow text-[10px]">精华</span> : null}
                    <span className="text-[10px] px-2 py-0.5 rounded bg-brand-500/10 text-brand-500">{t.category.name}</span>
                    <span className="text-sm sm:text-base text-ink-50 font-medium truncate">{t.title}</span>
                  </div>
                  <div className="text-xs text-ink-400 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{t.author.display_name ?? t.author.username}</span>
                    <span>·</span>
                    <span>{fmtRelative(t.created_at)}</span>
                    <span>·</span>
                    <span>{t.reply_count} 回 · {t.view_count} 阅</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {list.data && list.data.total > list.data.page_size && (
          <Pagination total={list.data.total} page={list.data.page} pageSize={list.data.page_size}
            onChange={(p) => { params.set("page", String(p)); setParams(params); }} />
        )}
      </main>

      <aside className="space-y-5">
        <div className="card p-5">
          <div className="text-xs font-mono text-brand-500 tracking-widest mb-3">LEGACY · 老分类</div>
          <ul className="space-y-1 text-sm max-h-[60vh] overflow-auto">
            <li>
              <button onClick={() => { params.delete("category"); params.delete("page"); setParams(params); }}
                className={`w-full text-left px-3 py-2 rounded transition ${!category ? "bg-brand-500/15 text-brand-500" : "hover:bg-brand-500/8 text-ink-100"}`}>
                全部老帖 ({list.data?.total ?? "…"})
              </button>
            </li>
            {roots.map((c) => (
              <li key={c.id}>
                <button onClick={() => { params.set("category", c.slug); params.delete("page"); setParams(params); }}
                  className={`w-full text-left flex items-center justify-between px-3 py-2 rounded transition ${category === c.slug ? "bg-brand-500/15 text-brand-500" : "hover:bg-brand-500/8 text-ink-100"}`}>
                  <span>{c.name}</span>
                  <span className="text-xs text-ink-400">{c.thread_count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-5">
          <Link to="/" className="text-sm text-brand-500 hover:underline">← 返回新论坛</Link>
        </div>
      </aside>
    </div>
  );
}

function Pagination({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (p: number) => void }) {
  const last = Math.ceil(total / pageSize);
  const pages = Array.from({ length: Math.min(last, 7) }, (_, i) => {
    const start = Math.max(1, Math.min(page - 3, last - 6));
    return start + i;
  }).filter((p) => p >= 1 && p <= last);
  return (
    <div className="flex items-center justify-center gap-1 mt-6">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="btn-ghost text-sm px-3 py-1.5 disabled:opacity-30">上一页</button>
      {pages.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={`px-3 py-1.5 rounded text-sm transition ${p === page ? "bg-brand-500 text-white" : "text-ink-200 hover:bg-brand-500/10"}`}>{p}</button>
      ))}
      <button disabled={page >= last} onClick={() => onChange(page + 1)} className="btn-ghost text-sm px-3 py-1.5 disabled:opacity-30">下一页</button>
    </div>
  );
}
