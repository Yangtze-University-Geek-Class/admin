import { useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "../../lib/api";

type Overview = {
  org: any;
  counts: { members: number; repos: number; pending_invites: number; invites_24h: number };
};

const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <div className="card p-5">
    <div className="text-xs text-ink-500 uppercase tracking-wider">{label}</div>
    <div className="text-3xl font-semibold text-ink-50 mt-2">{value}</div>
    {hint && <div className="text-xs text-ink-500 mt-1">{hint}</div>}
  </div>
);

export default function Overview() {
  const { data, isLoading, error } = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/api/admin/overview") });

  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">加载失败：{(error as Error).message}</div>;

  const org = data!.org;
  const c = data!.counts;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <header className="flex items-center gap-4 mb-8">
        <img src={org.avatar_url} alt="" className="w-14 h-14 rounded-xl border border-ink-700" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-ink-50 truncate">{org.name ?? org.login}</h1>
          <div className="text-ink-500 text-sm font-mono">@{org.login}</div>
        </div>
        <a href={org.html_url} target="_blank" rel="noreferrer" className="btn-ghost text-sm">在 GitHub 打开</a>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Stat label="成员" value={c.members} />
        <Stat label="仓库" value={c.repos} hint={`${org.public_repos} 公开 / ${org.total_private_repos} 私有`} />
        <Stat label="待处理邀请" value={c.pending_invites} hint={`24h 提交 ${c.invites_24h} 条申请`} />
        <Stat label="存储用量" value={`${(org.disk_usage_mb / 1024).toFixed(2)} MB`} />
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink-100 mb-4">组织信息</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Row k="Plan" v={org.plan ?? "—"} />
          <Row k="创建时间" v={fmtDate(org.created_at)} />
          <Row k="Billing 邮箱" v={org.billing_email ?? "—"} />
          <Row k="2FA 强制" v={org.two_factor_required ? "是" : "否"} />
          <Row k="描述" v={org.description ?? "—"} />
        </dl>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex">
    <dt className="w-28 text-ink-500">{k}</dt>
    <dd className="text-ink-200 flex-1">{v}</dd>
  </div>
);
