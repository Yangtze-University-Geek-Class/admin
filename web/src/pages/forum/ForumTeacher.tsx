import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtRelative } from "../../lib/api";
import { Avatar } from "./ForumLayout";

type Me = { signed_in: boolean; user?: { id: number; username: string; role: string; display_name: string | null } };
type Overview = {
  counts: Record<string, number>;
  category_breakdown: { id: number; slug: string; name: string; thread_count: number; post_count: number }[];
  top_contributors: { id: number; username: string; display_name: string | null; avatar_url: string | null; role: string; thread_count: number; post_count: number; liked_count: number }[];
  recent_threads: any[];
  recent_signups: { id: number; username: string; display_name: string | null; avatar_url: string | null; role: string; github_login: string | null; created_at: number }[];
};

export default function ForumTeacher() {
  const me = useQuery({ queryKey: ["forum-me"], queryFn: () => api<Me>("/api/forum/me") });
  const u = me.data?.user;
  const ok = u && ["teacher", "admin", "mod"].includes(u.role);
  const data = useQuery({
    queryKey: ["forum-teacher-overview"],
    queryFn: () => api<Overview>("/api/forum/teacher/overview"),
    enabled: Boolean(ok),
  });

  if (me.isLoading) return <div className="max-w-6xl mx-auto px-6 py-12 text-ink-400">…</div>;
  if (!u) return <Navigate to="/login?return_to=/teacher" replace />;
  if (!ok) {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="card p-8">
          <h1 className="text-lg font-semibold text-ink-50 mb-2">无权访问</h1>
          <p className="text-ink-300 text-sm mb-5">仅老师 / 负责人可访问此页面</p>
          <Link to="/" className="btn-ghost text-sm px-4 py-2">返回论坛</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <nav className="text-sm text-ink-400 mb-3">
        <Link to="/" className="hover:text-brand-500">论坛</Link>
        <span className="mx-2">/</span>
        <span className="text-ink-100">老师面板</span>
      </nav>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink-50">极客班全景</h1>
        <p className="text-ink-300 text-sm mt-1">
          当前身份：<span className="text-brand-500 font-medium">{u.role === "teacher" ? "老师" : "负责人"}</span> · @{u.username}
          {u.role === "teacher" && " · 只读视图"}
        </p>
      </header>

      {data.isLoading && <div className="text-ink-400">加载中…</div>}
      {data.data && (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-8">
            <Metric label="总成员" value={data.data.counts.total_members} />
            <Metric label="负责人" value={data.data.counts.admin} />
            <Metric label="老师" value={data.data.counts.teacher} />
            <Metric label="成员" value={data.data.counts.member} />
            <Metric label="主题" value={data.data.counts.threads_total} />
            <Metric label="回帖" value={data.data.counts.posts_total} />
            <Metric label="今日发帖" value={data.data.counts.threads_today + data.data.counts.posts_today} sub="主题+回帖" />
            <Metric label="7d 活跃" value={data.data.counts.active_users_7d} />
          </section>

          <div className="grid lg:grid-cols-[1fr_320px] gap-6">
            <main className="space-y-6">
              <section className="card p-5">
                <h2 className="font-semibold text-ink-50 mb-4">最新主题</h2>
                <ul className="divide-y divide-brand-500/10">
                  {data.data.recent_threads.map((t) => (
                    <li key={t.id} className="py-3">
                      <div className="flex items-start gap-3">
                        <Avatar user={t.author} size={32} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-brand-500/10 text-brand-500">{t.category.name}</span>
                            <Link to={`/t/${t.id}`} className="text-sm text-ink-100 hover:text-brand-500 truncate">{t.title}</Link>
                          </div>
                          <div className="text-xs text-ink-400 mt-1">
                            <Link to={`/u/${t.author.username}`} className="hover:text-brand-500">
                              {t.author.display_name ?? t.author.username}
                            </Link>
                            <span> · {fmtRelative(t.created_at)} · {t.reply_count} 回 · {t.view_count} 阅</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card p-5">
                <h2 className="font-semibold text-ink-50 mb-4">分类分布</h2>
                <table className="w-full text-sm">
                  <thead className="text-xs text-ink-400 uppercase tracking-wider">
                    <tr>
                      <th className="text-left py-2">分类</th>
                      <th className="text-right py-2">主题</th>
                      <th className="text-right py-2">回帖</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-500/10">
                    {data.data.category_breakdown.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2 text-ink-100">
                          <Link to={`/c/${encodeURIComponent(c.slug)}`} className="hover:text-brand-500">{c.name}</Link>
                        </td>
                        <td className="py-2 text-right text-ink-200">{c.thread_count}</td>
                        <td className="py-2 text-right text-ink-300">{c.post_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </main>

            <aside className="space-y-6">
              <section className="card p-5">
                <h2 className="font-semibold text-ink-50 mb-4">活跃贡献者</h2>
                <ul className="space-y-2">
                  {data.data.top_contributors.map((c, i) => (
                    <li key={c.id}>
                      <Link to={`/u/${c.username}`} className="flex items-center gap-2 hover:bg-brand-500/5 -mx-2 px-2 py-1 rounded transition">
                        <span className="text-xs text-ink-400 w-5">#{i + 1}</span>
                        <Avatar user={c} size={24} />
                        <span className="text-sm text-ink-100 flex-1 truncate">{c.display_name ?? c.username}</span>
                        <span className="text-xs text-ink-400">{c.thread_count}·{c.post_count}·{c.liked_count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-ink-400 mt-3">数字：主题·回帖·获赞</p>
              </section>

              <section className="card p-5">
                <h2 className="font-semibold text-ink-50 mb-4">最近注册</h2>
                <ul className="space-y-2">
                  {data.data.recent_signups.map((s) => (
                    <li key={s.id}>
                      <Link to={`/u/${s.username}`} className="flex items-center gap-2 hover:bg-brand-500/5 -mx-2 px-2 py-1 rounded transition">
                        <Avatar user={s} size={24} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-ink-100 truncate">{s.display_name ?? s.username}</div>
                          <div className="text-xs text-ink-400">{fmtRelative(s.created_at)}</div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-400">{label}</div>
      <div className="text-xl font-bold text-ink-50 mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-ink-400 mt-0.5">{sub}</div>}
    </div>
  );
}
