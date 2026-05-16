import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtRelative } from "../../lib/api";
import { Avatar } from "./ForumLayout";

type User = {
  id: number; username: string; display_name: string | null; avatar_url: string | null;
  role: string; signature: string | null; bio: string | null; github_login: string | null;
  thread_count: number; post_count: number; liked_count: number;
  last_seen_at: number | null; created_at: number;
};

export default function ForumProfile() {
  const { username } = useParams();
  const profile = useQuery({
    queryKey: ["forum-user", username],
    queryFn: () => api<{ user: User; recent_threads: any[] }>(`/api/forum/users/${encodeURIComponent(username ?? "")}`),
    enabled: Boolean(username),
  });

  if (profile.isLoading) return <div className="max-w-4xl mx-auto px-6 py-12 text-ink-400">…</div>;
  if (profile.error) return <div className="max-w-4xl mx-auto px-6 py-12 text-rose-500">{(profile.error as Error).message}</div>;
  if (!profile.data) return null;
  const u = profile.data.user;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="card p-6">
        <div className="flex items-start gap-5">
          <Avatar user={u} size={80} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-ink-50">{u.display_name ?? u.username}</h1>
              {u.role === "admin" && <span className="tag-blue text-[10px]">admin</span>}
              {u.role === "mod" && <span className="tag-yellow text-[10px]">mod</span>}
            </div>
            <div className="text-sm text-ink-400 mt-0.5">@{u.username}</div>
            {u.github_login && (
              <a href={`https://github.com/${u.github_login}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-brand-500 hover:underline mt-1">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.11.78-.25.78-.55v-1.95c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 015.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.79.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
                @{u.github_login}
              </a>
            )}
            {u.signature && <p className="text-sm text-ink-200 mt-3">{u.signature}</p>}
            {u.bio && <p className="text-sm text-ink-300 mt-2">{u.bio}</p>}
            <div className="flex gap-6 mt-4 text-sm">
              <Stat label="主题" value={u.thread_count} />
              <Stat label="回帖" value={u.post_count} />
              <Stat label="获赞" value={u.liked_count} />
            </div>
            <div className="text-xs text-ink-400 mt-3">
              注册：{fmtDate(u.created_at)}
              {u.last_seen_at && <> · 最近活跃：{fmtRelative(u.last_seen_at)}</>}
            </div>
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-ink-50 mt-8 mb-3">最近主题</h2>
      <div className="card overflow-hidden divide-y divide-brand-500/10">
        {profile.data.recent_threads.length === 0 && <div className="p-6 text-center text-ink-400 text-sm">还没有发过主题</div>}
        {profile.data.recent_threads.map((t: any) => (
          <Link key={t.id} to={`/t/${t.id}`} className="block p-4 hover:bg-brand-500/5 transition">
            <div className="flex items-center gap-3">
              <Link to={`/c/${encodeURIComponent(t.category_slug)}`} onClick={(e) => e.stopPropagation()}
                className="text-[10px] px-2 py-0.5 rounded bg-brand-500/10 text-brand-500">{t.category_name}</Link>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink-100 truncate">{t.title}</div>
                <div className="text-xs text-ink-400 mt-0.5">{fmtRelative(t.created_at)} · {t.reply_count} 回 · {t.view_count} 阅</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div><span className="text-ink-50 font-bold text-base">{value}</span> <span className="text-ink-400">{label}</span></div>;
}
