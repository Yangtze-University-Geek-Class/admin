import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { api } from "../../lib/api";

type Ctx = { isAdmin: boolean };

const TEXT_FIELDS: { key: string; label: string }[] = [
  { key: "name", label: "Display name" },
  { key: "description", label: "描述" },
  { key: "company", label: "Company" },
  { key: "email", label: "公开邮箱" },
  { key: "location", label: "Location" },
  { key: "blog", label: "Blog URL" },
  { key: "twitter_username", label: "Twitter" },
  { key: "billing_email", label: "Billing 邮箱" },
];

const BOOL_FIELDS: { key: string; label: string }[] = [
  { key: "members_can_create_repositories", label: "成员可创建仓库" },
  { key: "members_can_create_public_repositories", label: "可创建公开仓库" },
  { key: "members_can_create_private_repositories", label: "可创建私有仓库" },
  { key: "members_can_fork_private_repositories", label: "可 fork 私有仓库" },
  { key: "members_can_create_pages", label: "可发布 Pages" },
  { key: "members_can_invite_outside_collaborators", label: "可邀请外部协作者" },
  { key: "members_can_delete_repositories", label: "可删除仓库（建议关）" },
  { key: "members_can_change_repo_visibility", label: "可改仓库可见性（建议关）" },
];

export default function OrgSettings() {
  const { org } = useParams();
  const { isAdmin } = useOutletContext<Ctx>();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["org-info", org],
    queryFn: () => api<any>(`/api/admin/${org}/org`),
  });
  const [draft, setDraft] = useState<Record<string, any>>({});
  useEffect(() => { if (data) setDraft({}); }, [data]);

  const save = useMutation({
    mutationFn: () => api(`/api/admin/${org}/org`, { method: "PATCH", body: JSON.stringify(draft) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-info", org] }); qc.invalidateQueries({ queryKey: ["overview", org] }); setDraft({}); },
  });

  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  const get = (k: string) => (k in draft ? draft[k] : data[k]);
  const set = (k: string, v: any) => { if (!isAdmin) return; setDraft({ ...draft, [k]: v }); };
  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto space-y-6">
      <header className="flex items-center gap-4">
        <img src={data.avatar_url} alt="" className="w-14 h-14 rounded-xl border border-ink-700" />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-ink-50">组织资料</h1>
          <div className="text-xs text-ink-500 font-mono">@{data.login}</div>
        </div>
        {!isAdmin && <span className="text-xs text-ink-500">只读视图</span>}
      </header>

      <div className="card p-5">
        <h2 className="font-semibold text-ink-100 mb-4">基本资料</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TEXT_FIELDS.map((f) => (
            <div key={f.key} className={f.key === "description" ? "md:col-span-2" : ""}>
              <label className="label">{f.label}</label>
              {f.key === "description" ? (
                <textarea className="input min-h-[70px]" value={get(f.key) ?? ""} disabled={!isAdmin} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input className="input" value={get(f.key) ?? ""} disabled={!isAdmin} onChange={(e) => set(f.key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-ink-100 mb-4">默认权限</h2>
        <div className="mb-4">
          <label className="label">所有成员对仓库的基础权限</label>
          <select className="input md:max-w-xs" disabled={!isAdmin}
            value={get("default_repository_permission") ?? "read"}
            onChange={(e) => set("default_repository_permission", e.target.value)}>
            <option value="none">none</option>
            <option value="read">read</option>
            <option value="write">write</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {BOOL_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-3 p-2 hover:bg-ink-800/40 rounded cursor-pointer">
              <input type="checkbox" className="accent-brand-500 w-4 h-4" disabled={!isAdmin}
                checked={Boolean(get(f.key))} onChange={(e) => set(f.key, e.target.checked)} />
              <span className="text-sm text-ink-200">{f.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-ink-100 mb-3">不能通过 API 修改</h2>
        <ul className="text-sm text-ink-400 space-y-2">
          <li>组织 login (URL 里的标识) · <a href={`https://github.com/organizations/${data.login}/settings/profile`} target="_blank" rel="noreferrer" className="text-brand-500">去 GitHub 改名</a></li>
          <li>头像 · <a href={`https://github.com/organizations/${data.login}/settings/profile`} target="_blank" rel="noreferrer" className="text-brand-500">去 GitHub 上传</a></li>
        </ul>
      </div>

      {isAdmin && (
        <div className="sticky bottom-4 flex justify-end">
          <button className="btn-primary shadow-glow" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : dirty ? `保存 (${Object.keys(draft).length} 项)` : "无修改"}
          </button>
        </div>
      )}
      {save.error && <div className="text-rose-400 text-sm">{(save.error as Error).message}</div>}
    </div>
  );
}
