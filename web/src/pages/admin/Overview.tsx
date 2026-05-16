import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api, fmtDate } from "../../lib/api";

type Overview = { role: string; org: any; counts: { members: number; repos: number; pending_invites: number; invites_24h: number; active_invite_links: number } };

const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <div className="card p-5">
    <div className="text-xs text-ink-500 uppercase tracking-wider">{label}</div>
    <div className="text-3xl font-semibold text-ink-50 mt-2">{value}</div>
    {hint && <div className="text-xs text-ink-500 mt-1">{hint}</div>}
  </div>
);

export default function Overview() {
  const { org } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview", org],
    queryFn: () => api<Overview>(`/api/admin/${org}/overview`),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;
  const o = data!.org;
  const c = data!.counts;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <header className="flex items-center gap-4 mb-8">
        <img src={o.avatar_url} alt="" className="w-14 h-14 rounded-xl border border-ink-700" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-ink-50 truncate">{o.name ?? o.login}</h1>
          <div className="text-ink-500 text-sm font-mono">@{o.login} · 你的角色 <span className={data!.role === "admin" ? "tag-blue ml-1" : "tag-gray ml-1"}>{data!.role}</span></div>
        </div>
        <a href={o.html_url} target="_blank" rel="noreferrer" className="btn-ghost text-sm">在 GitHub 打开</a>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="成员" value={c.members} />
        <Stat label="仓库" value={c.repos} hint={`${o.public_repos} 公开 / ${o.total_private_repos} 私有`} />
        <Stat label="待处理邀请" value={c.pending_invites} hint={`24h 申请 ${c.invites_24h}`} />
        <Stat label="活跃邀请链接" value={c.active_invite_links} />
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink-100 mb-4">组织信息</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Row k="Plan" v={o.plan ?? "—"} />
          <Row k="创建时间" v={fmtDate(o.created_at)} />
          <Row k="Billing 邮箱" v={o.billing_email ?? "—"} />
          <Row k="2FA 强制" v={o.two_factor_required ? "是" : "否"} />
          <Row k="存储用量" v={`${(o.disk_usage_mb / 1024).toFixed(2)} MB`} />
          <Row k="描述" v={o.description ?? "—"} />
        </dl>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex">
    <dt className="w-28 text-ink-500">{k}</dt>
    <dd className="text-ink-200 flex-1 break-words">{v}</dd>
  </div>
);
