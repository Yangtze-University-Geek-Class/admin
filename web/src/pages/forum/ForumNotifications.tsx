import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtRelative } from "../../lib/api";
import { Avatar } from "./ForumLayout";
import BackBar from "../../components/BackBar";

type Me = { signed_in: boolean; user?: { id: number } };
type Notif = {
  id: number; type: string; thread_id: number | null; post_id: number | null; title: string | null;
  body: string | null; read_at: number | null; created_at: number;
  from_user_id: number | null; from_username: string | null; from_display_name: string | null; from_avatar_url: string | null;
};

export default function ForumNotifications() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["forum-me"], queryFn: () => api<Me>("/api/forum/me") });
  const list = useQuery({
    queryKey: ["forum-notifications"],
    enabled: Boolean(me.data?.user),
    queryFn: () => api<{ notifications: Notif[]; unread: number }>(`/api/forum/me/notifications`),
  });
  const markAll = useMutation({
    mutationFn: () => api(`/api/forum/me/notifications/read-all`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum-notifications"] }),
  });

  if (me.isLoading) return <div className="max-w-3xl mx-auto px-6 py-12 text-ink-400">…</div>;
  if (!me.data?.user) return <Navigate to="/login?return_to=/me/notifications" replace />;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <BackBar fallback="/me" label="返回" />
      <header className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-50">通知中心</h1>
          <p className="text-ink-300 text-sm mt-1">未读 {list.data?.unread ?? 0} 条</p>
        </div>
        <button onClick={() => markAll.mutate()} disabled={!list.data?.unread || markAll.isPending}
          className="btn-ghost text-sm px-4 py-2 disabled:opacity-40">全部标为已读</button>
      </header>
      <div className="card overflow-hidden divide-y divide-brand-500/10">
        {list.data?.notifications.length === 0 && <div className="p-10 text-center text-ink-400 text-sm">还没有通知</div>}
        {list.data?.notifications.map((n) => (
          <Link key={n.id}
            to={n.thread_id ? `/t/${n.thread_id}` : "#"}
            className={`flex items-start gap-3 p-4 hover:bg-brand-500/5 transition ${!n.read_at ? "bg-brand-500/5" : ""}`}>
            {n.from_username && (
              <Avatar user={{ username: n.from_username, display_name: n.from_display_name, avatar_url: n.from_avatar_url }} size={36} />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink-100">
                <span className="font-medium text-brand-500">{n.from_display_name ?? n.from_username ?? "系统"}</span>
                {n.type === "reply" && " 回复了你"}
                {n.title && <span className="text-ink-300 ml-2 truncate">「{n.title}」</span>}
              </div>
              <div className="text-xs text-ink-400 mt-1">{fmtRelative(n.created_at)}</div>
            </div>
            {!n.read_at && <span className="w-2 h-2 bg-brand-500 rounded-full mt-2"></span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
