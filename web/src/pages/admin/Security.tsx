import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export default function Security() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["security"],
    queryFn: () => api<any>("/api/admin/security"),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-ink-50">安全</h1>

      <section className="card p-5">
        <h2 className="font-semibold text-ink-100 mb-3">Dependabot 警报</h2>
        {data.dependabot_error ? (
          <div className="text-amber-400 text-sm">{data.dependabot_error}（Free plan 私有仓库可能受限）</div>
        ) : data.dependabot_alerts.length === 0 ? (
          <div className="text-ink-500 text-sm">无开放警报</div>
        ) : (
          <ul className="space-y-3">
            {data.dependabot_alerts.map((a: any) => (
              <li key={a.number} className="flex items-start gap-3 text-sm">
                <span className={`tag-${a.security_advisory?.severity === "critical" || a.security_advisory?.severity === "high" ? "red" : "yellow"}`}>
                  {a.security_advisory?.severity}
                </span>
                <div className="flex-1">
                  <div className="text-ink-200">{a.security_advisory?.summary}</div>
                  <div className="text-xs text-ink-500 mt-0.5">{a.repository?.full_name} · {a.dependency?.package?.name}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5 text-sm text-ink-400">
        <h2 className="font-semibold text-ink-100 mb-2">Audit log / Secret scanning</h2>
        <p>这两项需要 GitHub Pro / Enterprise plan。当前 Free plan 不可用。</p>
      </section>
    </div>
  );
}
