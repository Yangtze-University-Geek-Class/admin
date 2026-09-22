import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useOutletContext, useNavigate } from "react-router-dom";
import { api } from "@shared/lib/api";
import Select from "@shared/ui/Select";
import { useConfirm } from "@shared/ui/ConfirmDialog";

export function CollaboratorRow({ c, org, repo }: { c: any; org: string; repo: string }) {
  const qc = useQueryClient();
  const { isAdmin } = useOutletContext<{ isAdmin: boolean }>();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const setPerm = useMutation({
    mutationFn: (perm: string) => api(`/api/admin/${org}/repos/${repo}/collaborators/${c.login}`, {
      method: "PUT", body: JSON.stringify({ permission: perm }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["repo", org, repo] }); setEditing(false); },
  });
  const rm = useMutation({
    mutationFn: () => api(`/api/admin/${org}/repos/${repo}/collaborators/${c.login}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repo", org, repo] }),
  });
  return (
    <li className="flex items-center gap-3 py-2.5">
      <img src={c.avatar_url} alt="" className="w-7 h-7 rounded-full border border-ink-700/60" />
      <span className="flex-1 font-mono text-ink-200 text-sm">@{c.login}</span>
      {!isAdmin ? <span className="tag-blue">{c.role}</span> : editing ? (
        <div className="w-44">
          <Select value={c.role} onChange={(v) => setPerm.mutate(v)} options={[
            { value: "pull", label: "read" },
            { value: "triage", label: "triage" },
            { value: "push", label: "write" },
            { value: "maintain", label: "maintain" },
            { value: "admin", label: "admin" },
          ]} />
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="tag-blue hover:bg-brand-500/25 transition">{c.role || "read"} · 改</button>
      )}
      {isAdmin && <button className="text-xs text-rose-400 hover:underline ml-1"
        onClick={async () => {
          const ok = await confirm({ title: `撤销 @${c.login} 的额外权限？`, body: "撤销后回到组织默认权限 (read)。", confirmText: "撤销", variant: "danger" });
          if (ok) rm.mutate();
        }}>撤销</button>}
      {(setPerm.error || rm.error) && <span role="alert" className="text-rose-500 text-xs">{((setPerm.error || rm.error) as Error).message}</span>}
    </li>
  );
}

export function SettingsTab({ info, branches, collaborators, hooks }: { info: any; branches: any[]; collaborators: any[]; hooks: any[] }) {
  const { org, repo } = useParams();
  const { isAdmin } = useOutletContext<{ isAdmin: boolean }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const delRepo = useMutation({
    mutationFn: () => api(`/api/admin/${org}/repos/${repo}`, { method: "DELETE" }),
    onSuccess: () => navigate(`/admin/${org}/repos`),
  });

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="font-semibold text-ink-100 mb-3">分支 ({branches.length})</h2>
        <ul className="space-y-2 max-h-72 overflow-auto">
          {branches.map((b: any) => (
            <li key={b.name} className="flex items-center justify-between text-sm py-1">
              <span className="font-mono text-ink-200">{b.name}{b.name === info.default_branch && <span className="ml-2 tag-blue text-[10px]">默认</span>}</span>
              {b.protected ? <span className="tag-green">protected</span> : <span className="tag-gray">open</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-ink-100">仓库权限 ({collaborators.length} 人)</h2>
          <a href={`https://github.com/${org}/${repo}/settings/access`} target="_blank" rel="noreferrer"
            className="text-xs text-ink-400 hover:text-brand-500">在 GitHub 管理 →</a>
        </div>
        <p className="text-xs text-ink-400 mb-3">
          组织 <span className="font-mono text-ink-300">@{org}</span> 的成员默认对此仓库有 read 权限。这里可以单独提升某人的权限到 triage / write / maintain / admin。
        </p>
        <ul className="divide-y divide-ink-800/60">
          {collaborators.map((c: any) => (
            <CollaboratorRow key={c.login} c={c} org={org!} repo={repo!} />
          ))}
        </ul>
      </div>

      {hooks.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold text-ink-100 mb-3">Webhooks ({hooks.length})</h2>
          <ul className="space-y-2">
            {hooks.map((h: any) => (
              <li key={h.id} className="text-sm flex items-center gap-3">
                <span className={h.active ? "tag-green" : "tag-gray"}>{h.active ? "active" : "off"}</span>
                <span className="font-mono text-ink-200 truncate flex-1">{h.url ?? h.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && <div className="card p-5 border border-rose-500/40 bg-rose-500/5">
        <h2 className="font-semibold text-rose-300 mb-2">危险区</h2>
        <p className="text-sm text-ink-300 mb-3">删除仓库会**永久**删除代码、issue、PR、wiki、所有协作者关联。无法恢复。</p>
        {delRepo.error && <p role="alert" className="text-rose-500">{(delRepo.error as Error).message}</p>}
        <button disabled={delRepo.isPending} className="btn-danger text-sm"
          onClick={async () => {
            const ok = await confirm({
              title: `删除仓库 ${org}/${repo}？`,
              body: `这将永久删除所有代码、issues、PRs、releases、wiki。无法恢复。请确认你已备份。`,
              confirmText: "我已了解，删除",
              variant: "danger",
            });
            if (ok) delRepo.mutate();
          }}>删除仓库</button>
      </div>}
    </div>
  );
}
