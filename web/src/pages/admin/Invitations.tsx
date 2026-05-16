import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fmtDate, fmtRelative } from "../../lib/api";

export default function Invitations() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => api<{ pending: any[]; history: any[] }>("/api/admin/invitations"),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => api(`/api/admin/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
  });

  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-50">邀请</h1>
        <p className="text-ink-500 text-sm mt-1">
          公开链接：<a href="/" target="_blank" className="text-brand-500 font-mono">{location.origin}/</a>
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold text-ink-100 mb-3">待处理 {data!.pending.length}</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/60 text-ink-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">受邀人</th>
                <th className="text-left px-5 py-3">角色</th>
                <th className="text-left px-5 py-3">邀请人</th>
                <th className="text-left px-5 py-3">创建于</th>
                <th className="text-right px-5 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/60">
              {data!.pending.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-500">无待处理邀请</td></tr>
              )}
              {data!.pending.map((p) => (
                <tr key={p.id} className="hover:bg-ink-800/30">
                  <td className="px-5 py-3 font-mono text-ink-100">{p.login ? `@${p.login}` : p.email}</td>
                  <td className="px-5 py-3"><span className="tag-blue">{p.role}</span></td>
                  <td className="px-5 py-3 text-ink-300">{p.inviter?.login ? `@${p.inviter.login}` : "—"}</td>
                  <td className="px-5 py-3 text-ink-400">{fmtRelative(p.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <button className="btn-danger text-xs py-1 px-2"
                      onClick={() => { if (confirm("取消该邀请?")) cancel.mutate(p.id); }}>取消</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink-100 mb-3">历史记录</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/60 text-ink-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">受邀人</th>
                <th className="text-left px-5 py-3">备注</th>
                <th className="text-left px-5 py-3">状态</th>
                <th className="text-left px-5 py-3">来源 IP</th>
                <th className="text-left px-5 py-3">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/60">
              {data!.history.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-500">暂无历史</td></tr>
              )}
              {data!.history.map((h: any) => (
                <tr key={h.id} className="hover:bg-ink-800/30">
                  <td className="px-5 py-3 font-mono text-ink-100">{h.github_login ? `@${h.github_login}` : h.email}</td>
                  <td className="px-5 py-3 text-ink-300 max-w-xs truncate">{h.note ?? "—"}</td>
                  <td className="px-5 py-3"><StatusTag s={h.status} /></td>
                  <td className="px-5 py-3 text-ink-400 font-mono text-xs">{h.source_ip ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-400 whitespace-nowrap">{fmtDate(h.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const StatusTag = ({ s }: { s: string }) => {
  if (s === "sent") return <span className="tag-green">sent</span>;
  if (s === "failed") return <span className="tag-red">failed</span>;
  if (s === "pending_admin") return <span className="tag-yellow">deferred</span>;
  return <span className="tag-gray">{s}</span>;
};
