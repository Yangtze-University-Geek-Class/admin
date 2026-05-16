import { useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "../../lib/api";

export default function Logs() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api<{ logs: any[] }>("/api/admin/logs"),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">
      <header className="mb-6"><h1 className="text-2xl font-semibold text-ink-50">操作日志</h1></header>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/60 text-ink-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">时间</th>
              <th className="text-left px-5 py-3">操作者</th>
              <th className="text-left px-5 py-3">动作</th>
              <th className="text-left px-5 py-3">目标</th>
              <th className="text-left px-5 py-3">IP</th>
              <th className="text-left px-5 py-3">详情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800/60">
            {data!.logs.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-500">无日志</td></tr>
            )}
            {data!.logs.map((l: any) => (
              <tr key={l.id} className="hover:bg-ink-800/30">
                <td className="px-5 py-3 text-ink-400 whitespace-nowrap">{fmtDate(l.created_at)}</td>
                <td className="px-5 py-3 font-mono text-ink-200">{l.actor}</td>
                <td className="px-5 py-3"><span className="tag-blue text-[10px]">{l.action}</span></td>
                <td className="px-5 py-3 font-mono text-ink-300">{l.target ?? "—"}</td>
                <td className="px-5 py-3 font-mono text-xs text-ink-500">{l.ip ?? "—"}</td>
                <td className="px-5 py-3 text-xs text-ink-500 font-mono max-w-md truncate">
                  {l.details ? JSON.stringify(l.details) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
