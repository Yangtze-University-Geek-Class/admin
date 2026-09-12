import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "@shared/lib/api";

export default function Security() {
  const { org } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["security", org],
    queryFn: () => api<any>(`/api/admin/${org}/security`),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  const Card = ({ title, supported, reason, children }: { title: string; supported: boolean; reason: string | null; children?: React.ReactNode }) => (
    <section className="card p-5">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-semibold text-ink-100 flex-1">{title}</h2>
        {supported ? <span className="tag-green">supported</span> : <span className="tag-gray">unavailable</span>}
      </div>
      {!supported && reason && <p className="text-ink-500 text-sm">{reason}</p>}
      {supported && children}
    </section>
  );

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-ink-50">安全</h1>
      <div className="text-sm text-ink-500">当前 plan: <span className="font-mono text-ink-300">{data.plan}</span> · 2FA 强制: {data.two_factor_required ? "是" : "否"}</div>

      <Card title="Dependabot 警报" supported={data.dependabot.supported} reason={data.dependabot.reason}>
        {data.dependabot.error && <p className="text-amber-400 text-sm">{data.dependabot.error}</p>}
        {data.dependabot.alerts.length === 0 ? <p className="text-ink-500 text-sm">无开放警报</p> : (
          <ul className="space-y-3">
            {data.dependabot.alerts.map((a: any) => (
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
      </Card>

      <Card title="Secret scanning" supported={data.secret_scanning.supported} reason={data.secret_scanning.reason} />
      <Card title="Audit log" supported={data.audit_log.supported} reason={data.audit_log.reason} />
    </div>
  );
}
