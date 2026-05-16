import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useConfirm } from "../../components/ConfirmDialog";

type Ctx = { isAdmin: boolean };
type Member = { login: string; id: number; avatar_url: string; html_url: string; role: string; state: string };

export default function Members() {
  const { org } = useParams();
  const { isAdmin } = useOutletContext<Ctx>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, error } = useQuery({
    queryKey: ["members", org],
    queryFn: () => api<{ members: Member[] }>(`/api/admin/${org}/members`),
  });

  const remove = useMutation({
    mutationFn: (login: string) => api(`/api/admin/${org}/members/${login}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", org] }),
  });
  const setRole = useMutation({
    mutationFn: ({ login, role }: { login: string; role: "admin" | "member" }) =>
      api(`/api/admin/${org}/members/${login}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", org] }),
  });

  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-ink-50">成员</h1>
        <span className="text-ink-500 text-sm">{data!.members.length} 人</span>
        {!isAdmin && <span className="ml-auto text-xs text-ink-500">只读视图（你不是 org admin）</span>}
      </header>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/60 text-ink-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">用户</th>
              <th className="text-left px-5 py-3">角色</th>
              <th className="text-left px-5 py-3">状态</th>
              {isAdmin && <th className="text-right px-5 py-3">操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800/60">
            {data!.members.map((m) => (
              <tr key={m.login} className="hover:bg-ink-800/30">
                <td className="px-5 py-3">
                  <a href={m.html_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 group">
                    <img src={m.avatar_url} alt="" className="w-9 h-9 rounded-full border border-ink-700/60" />
                    <span className="font-mono text-ink-100 group-hover:text-brand-500">@{m.login}</span>
                  </a>
                </td>
                <td className="px-5 py-3">
                  {m.role === "admin" ? <span className="tag-blue">admin</span> : <span className="tag-gray">member</span>}
                </td>
                <td className="px-5 py-3 text-ink-400">{m.state}</td>
                {isAdmin && (
                  <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                    <button className="btn-ghost text-xs py-1 px-2"
                      onClick={() => setRole.mutate({ login: m.login, role: m.role === "admin" ? "member" : "admin" })}
                      disabled={setRole.isPending}>
                      {m.role === "admin" ? "降为 member" : "升为 admin"}
                    </button>
                    <button className="btn-danger text-xs py-1 px-2"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `移除成员 @${m.login}？`,
                          body: "对方将被从组织移除，所有继承自组织 / team 的权限失效。Ta 可以被重新邀请。",
                          confirmText: "移除",
                          variant: "danger",
                        });
                        if (ok) remove.mutate(m.login);
                      }}
                      disabled={remove.isPending}>
                      移除
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
