import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fmtRelative } from "../../lib/api";
import { Avatar } from "./ForumLayout";

type Category = { id: number; slug: string; name: string; description: string | null; parent_id: number | null; thread_count: number };
type ThreadItem = {
  id: number; title: string; reply_count: number; view_count: number;
  is_sticky: number; is_essence: number; last_posted_at: number; created_at: number;
  author: { id: number; username: string; display_name: string | null; avatar_url: string | null; role: string };
  last_poster: { id: number; username: string; display_name: string | null; avatar_url: string | null } | null;
  category: { slug: string; name: string };
};

export default function ForumHome() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = (params.get("sort") as "latest" | "hot") ?? "latest";
  const page = Number(params.get("page") ?? 1);

  const cats = useQuery({ queryKey: ["forum-categories"], queryFn: () => api<{ categories: Category[] }>("/api/forum/categories") });
  const list = useQuery({
    queryKey: ["forum-threads", { q, sort, page }],
    queryFn: () => api<{ threads: ThreadItem[]; total: number; page: number; page_size: number }>(
      `/api/forum/threads?${new URLSearchParams({ ...(q ? { q } : {}), sort, page: String(page) }).toString()}`,
    ),
  });

  const roots = (cats.data?.categories ?? []).filter((c) => !c.parent_id);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[1fr_280px] gap-8">
      <main>
        <div className="flex items-center gap-2 mb-5">
          <div className="text-2xl font-bold text-ink-50">
            {q ? `搜索：${q}` : sort === "hot" ? "热门" : "最新"}
          </div>
          <div className="ml-auto flex items-center gap-1 text-sm">
            <button onClick={() => { params.set("sort", "latest"); params.delete("page"); setParams(params); }}
              className={`px-3 py-1.5 rounded transition ${sort === "latest" ? "bg-brand-500/15 text-brand-500" : "text-ink-300 hover:bg-brand-500/8"}`}>最新</button>
            <button onClick={() => { params.set("sort", "hot"); params.delete("page"); setParams(params); }}
              className={`px-3 py-1.5 rounded transition ${sort === "hot" ? "bg-brand-500/15 text-brand-500" : "text-ink-300 hover:bg-brand-500/8"}`}>热门</button>
          </div>
        </div>

        {list.isLoading && <div className="text-ink-400">加载中…</div>}
        {list.error && <div className="text-rose-500">{(list.error as Error).message}</div>}
        {list.data?.threads.length === 0 && <div className="card p-10 text-center text-ink-300">还没有帖子</div>}

        <div className="card overflow-hidden divide-y divide-brand-500/10">
          {list.data?.threads.map((t) => (
            <Link key={t.id} to={`/t/${t.id}`} className="block p-4 hover:bg-brand-500/5 transition">
              <div className="flex gap-3">
                <Avatar user={t.author} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.is_sticky ? <span className="tag-blue text-[10px]">置顶</span> : null}
                    {t.is_essence ? <span className="tag-yellow text-[10px]">精华</span> : null}
                    <Link to={`/c/${encodeURIComponent(t.category.slug)}`} className="text-[10px] px-2 py-0.5 rounded bg-brand-500/10 text-brand-500 hover:bg-brand-500/20 transition" onClick={(e) => e.stopPropagation()}>{t.category.name}</Link>
                    <span className="text-sm sm:text-base text-ink-50 font-medium truncate">{t.title}</span>
                  </div>
                  <div className="text-xs text-ink-400 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{t.author.display_name ?? t.author.username}</span>
                    <span>·</span>
                    <span>{fmtRelative(t.created_at)} 发表</span>
                    {t.last_poster && t.last_posted_at !== t.created_at && (
                      <>
                        <span>·</span>
                        <span>最后回复 {t.last_poster.display_name ?? t.last_poster.username}</span>
                        <span>· {fmtRelative(t.last_posted_at)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 text-xs text-ink-400 hidden sm:block">
                  <div><span className="text-ink-100 font-semibold">{t.reply_count}</span> 回</div>
                  <div className="mt-1">{t.view_count} 阅</div>
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
          <div className="text-xs font-mono text-brand-500 tracking-widest mb-3">CATEGORIES</div>
          <ul className="space-y-1 text-sm">
            {roots.map((c) => (
              <li key={c.id}>
                <Link to={`/c/${encodeURIComponent(c.slug)}`}
                  className="flex items-center justify-between px-3 py-2 rounded hover:bg-brand-500/8 transition">
                  <span className="text-ink-100">{c.name}</span>
                  <span className="text-xs text-ink-400">{c.thread_count}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/categories" className="block mt-3 text-xs text-brand-500 hover:underline">查看全部分类 →</Link>
        </div>
        <div className="card p-5">
          <div className="text-xs font-mono text-brand-500 tracking-widest mb-3">QUICK LINKS</div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/" className="text-ink-100 hover:text-brand-500">← 返回首页</Link></li>
            <li><Link to="/docs" className="text-ink-100 hover:text-brand-500">使用文档</Link></li>
            <li><Link to="/feedback" className="text-ink-100 hover:text-brand-500">提交意见</Link></li>
          </ul>
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
