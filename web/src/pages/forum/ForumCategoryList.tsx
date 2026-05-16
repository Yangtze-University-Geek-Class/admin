import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

type Category = { id: number; slug: string; name: string; description: string | null; parent_id: number | null; thread_count: number };

export default function ForumCategoryList() {
  const cats = useQuery({ queryKey: ["forum-categories"], queryFn: () => api<{ categories: Category[] }>("/api/forum/categories") });
  const roots = (cats.data?.categories ?? []).filter((c) => !c.parent_id);
  const byParent = new Map<number, Category[]>();
  for (const c of cats.data?.categories ?? []) {
    if (c.parent_id) {
      const arr = byParent.get(c.parent_id) ?? [];
      arr.push(c);
      byParent.set(c.parent_id, arr);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <nav className="text-sm text-ink-400 mb-3">
        <Link to="/forum" className="hover:text-brand-500">论坛</Link>
        <span className="mx-2">/</span>
        <span className="text-ink-100">全部分类</span>
      </nav>
      <h1 className="text-2xl font-bold text-ink-50 mb-6">全部分类</h1>
      <div className="space-y-6">
        {roots.map((r) => {
          const children = byParent.get(r.id) ?? [];
          return (
            <div key={r.id} className="card overflow-hidden">
              <div className="p-5 border-b border-brand-500/10 flex items-center justify-between">
                <div>
                  <Link to={`/forum/c/${encodeURIComponent(r.slug)}`} className="font-semibold text-ink-50 text-lg hover:text-brand-500">{r.name}</Link>
                  {r.description && <p className="text-sm text-ink-300 mt-0.5">{r.description}</p>}
                </div>
                <div className="text-xs text-ink-400">{r.thread_count} 篇</div>
              </div>
              {children.length > 0 && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 divide-x divide-y divide-brand-500/10">
                  {children.map((c) => (
                    <Link key={c.id} to={`/forum/c/${encodeURIComponent(c.slug)}`}
                      className="p-4 hover:bg-brand-500/5 transition">
                      <div className="font-medium text-ink-100 text-sm">{c.name}</div>
                      {c.description && <div className="text-xs text-ink-300 mt-0.5 line-clamp-2">{c.description}</div>}
                      <div className="text-xs text-brand-500 mt-2">{c.thread_count} 篇 →</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {roots.length === 0 && !cats.isLoading && <div className="card p-10 text-center text-ink-400">还没有分类</div>}
      </div>
    </div>
  );
}
