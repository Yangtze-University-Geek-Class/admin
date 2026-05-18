import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtDate, fmtRelative } from "../../lib/api";
import { useConfirm } from "../../components/ConfirmDialog";

export default function Invitations() {
  const { org } = useParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [opError, setOpError] = useState<string | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["invitations", org],
    queryFn: () => api<{ pending: any[]; history: any[] }>(`/api/admin/${org}/invitations`),
  });
  const reload = async () => {
    setOpError(null);
    await qc.invalidateQueries({ queryKey: ["invitations", org] });
    await refetch();
  };
  const cancel = useMutation({
    mutationFn: (id: number) => api(`/api/admin/${org}/invitations/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setOpError(null);
      await qc.invalidateQueries({ queryKey: ["invitations", org] });
      await refetch();
    },
    onError: (e: any) => setOpError(`取消邀请失败: ${e?.message ?? e}（非 admin 角色或 GitHub 端已无此邀请会被拒）`),
  });

  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold text-ink-50">邀请</h1>
        <button onClick={reload} disabled={isFetching}
          className="btn-ghost text-sm px-3 py-2 disabled:opacity-50">
          {isFetching ? "刷新中…" : "刷新"}
        </button>
      </header>

      {opError && (
        <div className="card p-4 border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm flex items-start justify-between gap-3">
          <div>{opError}</div>
          <button onClick={() => setOpError(null)} className="text-rose-400 hover:text-rose-200 text-xs">关闭</button>
        </div>
      )}

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
              {data!.pending.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-500">无待处理邀请</td></tr>}
              {data!.pending.map((p) => (
                <tr key={p.id} className="hover:bg-ink-800/30">
                  <td className="px-5 py-3 font-mono text-ink-100">{p.login ? `@${p.login}` : p.email}</td>
                  <td className="px-5 py-3"><span className="tag-blue">{p.role}</span></td>
                  <td className="px-5 py-3 text-ink-300">{p.inviter?.login ? `@${p.inviter.login}` : "—"}</td>
                  <td className="px-5 py-3 text-ink-400">{fmtRelative(p.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <button className="btn-danger text-xs py-1 px-2 disabled:opacity-50"
                      disabled={cancel.isPending && cancel.variables === p.id}
                      onClick={async () => {
                        const ok = await confirm({
                          title: "取消该 GitHub 邀请？",
                          body: `${p.login ? `@${p.login}` : p.email} 将不再能通过此邀请加入。可随时重新发起。`,
                          confirmText: "取消邀请",
                          variant: "danger",
                        });
                        if (ok) cancel.mutate(p.id);
                      }}>
                      {cancel.isPending && cancel.variables === p.id ? "取消中…" : "取消"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink-100 mb-3">本站发起的历史</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/60 text-ink-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-5 py-3">受邀人</th>
                <th className="text-left px-5 py-3">备注</th>
                <th className="text-left px-5 py-3">链接</th>
                <th className="text-left px-5 py-3">状态</th>
                <th className="text-left px-5 py-3">来源 IP</th>
                <th className="text-left px-5 py-3">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/60">
              {data!.history.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-500">暂无历史</td></tr>}
              {data!.history.map((h: any) => (
                <tr key={h.id} className="hover:bg-ink-800/30">
                  <td className="px-5 py-3 font-mono text-ink-100">{h.github_login ? `@${h.github_login}` : h.email}</td>
                  <td className="px-5 py-3 text-ink-300 max-w-xs truncate">{h.note ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-500">{h.invite_link_token ?? "—"}</td>
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
  return <span className="tag-gray">{s}</span>;
};
