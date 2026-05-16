import { Link, useParams, useSearchParams } from "react-router-dom";
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

export default function ForumCategory() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);

  const cats = useQuery({ queryKey: ["forum-categories"], queryFn: () => api<{ categories: Category[] }>("/api/forum/categories") });
  const cat = cats.data?.categories.find((c) => c.slug === slug);
  const children = (cats.data?.categories ?? []).filter((c) => cat && c.parent_id === cat.id);
  const list = useQuery({
    queryKey: ["forum-threads", { category: slug, page }],
    enabled: Boolean(slug),
    queryFn: () => api<{ threads: ThreadItem[]; total: number; page: number; page_size: number }>(
      `/api/forum/threads?${new URLSearchParams({ category: slug ?? "", page: String(page) }).toString()}`,
    ),
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <nav className="text-sm text-ink-400 mb-3">
        <Link to="/" className="hover:text-brand-500">论坛</Link>
        <span className="mx-2">/</span>
        <span className="text-ink-100">{cat?.name ?? slug}</span>
      </nav>
      <header className="flex items-end justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-50">{cat?.name ?? slug}</h1>
          {cat?.description && <p className="text-ink-300 text-sm mt-1 max-w-2xl">{cat.description}</p>}
        </div>
        <Link to={`/new?category=${cat?.id ?? ""}`} className="btn-primary text-sm px-4 py-2 shrink-0">发帖</Link>
      </header>

      {children.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-6">
          {children.map((c) => (
            <Link key={c.id} to={`/c/${encodeURIComponent(c.slug)}`}
              className="card p-3 hover:border-brand-500/40 transition">
              <div className="font-medium text-ink-100 text-sm">{c.name}</div>
              <div className="text-xs text-ink-400 mt-0.5">{c.thread_count} 篇</div>
            </Link>
          ))}
        </div>
      )}

      {list.isLoading && <div className="text-ink-400">加载中…</div>}
      {list.data?.threads.length === 0 && <div className="card p-10 text-center text-ink-300">这个分类下还没有帖子，<Link to={`/new?category=${cat?.id ?? ""}`} className="text-brand-500 hover:underline">发第一个？</Link></div>}

      <div className="card overflow-hidden divide-y divide-brand-500/10">
        {list.data?.threads.map((t) => (
          <Link key={t.id} to={`/t/${t.id}`} className="block p-4 hover:bg-brand-500/5 transition">
            <div className="flex gap-3">
              <Avatar user={t.author} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {t.is_sticky ? <span className="tag-blue text-[10px]">置顶</span> : null}
                  {t.is_essence ? <span className="tag-yellow text-[10px]">精华</span> : null}
                  <span className="text-sm sm:text-base text-ink-50 font-medium truncate">{t.title}</span>
                </div>
                <div className="text-xs text-ink-400 mt-1 flex items-center gap-2 flex-wrap">
                  <span>{t.author.display_name ?? t.author.username}</span>
                  <span>·</span>
                  <span>{fmtRelative(t.created_at)}</span>
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
    </div>
  );
}
