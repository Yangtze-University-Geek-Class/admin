import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtDate, fmtRelative } from "../../lib/api";
import { useConfirm } from "../../components/ConfirmDialog";
import Select from "../../components/Select";
import NumberInput from "../../components/NumberInput";

type Link = {
  token: string; org: string; created_by: string; note: string | null;
  max_uses: number; current_uses: number; expires_at: number;
  team_slug: string | null; disabled: number; created_at: number;
};

export default function InviteLinks() {
  const { org } = useParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, error } = useQuery({
    queryKey: ["invite-links", org],
    queryFn: () => api<{ links: Link[] }>(`/api/admin/${org}/invite-links`),
  });
  const teams = useQuery({
    queryKey: ["teams-light", org],
    queryFn: () => api<{ teams: any[] }>(`/api/admin/${org}/teams`),
  });

  const [form, setForm] = useState({ hours: 24, max_uses: 30, note: "", team_slug: "" });
  const [created, setCreated] = useState<{ url: string; token: string } | null>(null);

  const create = useMutation({
    mutationFn: () => api<{ ok: boolean; token: string; url: string; expires_at: number }>(
      `/api/admin/${org}/invite-links`,
      { method: "POST", body: JSON.stringify({ ...form, team_slug: form.team_slug || null }) }
    ),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["invite-links", org] }); setCreated({ url: r.url, token: r.token }); },
  });
  const toggle = useMutation({
    mutationFn: ({ token, disabled }: { token: string; disabled: boolean }) =>
      api(`/api/admin/${org}/invite-links/${token}`, { method: "PATCH", body: JSON.stringify({ disabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invite-links", org] }),
  });
  const del = useMutation({
    mutationFn: (token: string) => api(`/api/admin/${org}/invite-links/${token}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invite-links", org] }),
  });

  const copy = (text: string) => navigator.clipboard.writeText(text);

  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink-50">邀请链接</h1>
        <p className="text-ink-400 text-sm mt-1">生成临时链接 → 发给目标 → 对方填 GitHub 用户名自动收到邀请</p>
      </header>

      <div className="card p-5">
        <h2 className="font-semibold text-ink-100 mb-4">生成新链接</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="label text-xs">有效期（小时）</label>
            <NumberInput min={1} max={8760}
              value={form.hours} onChange={(v) => setForm({ ...form, hours: v })} />
          </div>
          <div>
            <label className="label text-xs">最大使用次数</label>
            <NumberInput min={1} max={1000}
              value={form.max_uses} onChange={(v) => setForm({ ...form, max_uses: v })} />
          </div>
          <div className="md:col-span-2">
            <label className="label text-xs">备注（方便识别）</label>
            <input className="input" placeholder="例：2024 级新生群"
              value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">自动加入 team（可选）</label>
            <Select
              value={form.team_slug}
              onChange={(v) => setForm({ ...form, team_slug: v })}
              options={[
                { value: "", label: "— 不绑定 —" },
                ...(teams.data?.teams ?? []).map((t: any) => ({ value: t.slug, label: t.name, hint: t.slug })),
              ]}
            />
          </div>
        </div>
        <button className="btn-primary mt-4" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "生成中…" : "生成链接"}
        </button>
        {create.error && <div className="text-rose-400 text-sm mt-2">{(create.error as Error).message}</div>}

        {created && (
          <div className="mt-4 p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10">
            <div className="text-sm text-emerald-300 mb-2">链接已生成，复制下面 URL 发给目标</div>
            <div className="flex items-center gap-2">
              <input className="input font-mono text-xs flex-1" readOnly value={created.url} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className="btn-ghost text-xs" onClick={() => copy(created.url)}>复制</button>
            </div>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/60 text-ink-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">链接</th>
              <th className="text-left px-5 py-3">备注</th>
              <th className="text-left px-5 py-3">使用</th>
              <th className="text-left px-5 py-3">到期</th>
              <th className="text-left px-5 py-3">Team</th>
              <th className="text-left px-5 py-3">状态</th>
              <th className="text-right px-5 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800/60">
            {data!.links.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-ink-500">还没有邀请链接</td></tr>}
            {data!.links.map((l) => {
              const fullUrl = `${location.origin}/join/${l.token}`;
              const expired = l.expires_at < Date.now();
              const usedUp = l.current_uses >= l.max_uses;
              return (
                <tr key={l.token} className="hover:bg-ink-800/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs text-ink-300 truncate max-w-[180px]">/join/{l.token}</code>
                      <button className="text-xs text-brand-500 hover:underline" onClick={() => copy(fullUrl)}>复制</button>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-300 max-w-xs truncate">{l.note ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-300">{l.current_uses}/{l.max_uses}</td>
                  <td className="px-5 py-3 text-ink-400 whitespace-nowrap text-xs">{fmtRelative(l.expires_at)}<br /><span className="text-ink-600">{fmtDate(l.expires_at)}</span></td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-300">{l.team_slug ?? "—"}</td>
                  <td className="px-5 py-3">
                    {l.disabled ? <span className="tag-gray">disabled</span>
                      : expired ? <span className="tag-red">expired</span>
                      : usedUp ? <span className="tag-yellow">used up</span>
                      : <span className="tag-green">active</span>}
                  </td>
                  <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                    <button className="btn-ghost text-xs py-1 px-2"
                      onClick={() => toggle.mutate({ token: l.token, disabled: !l.disabled })}>
                      {l.disabled ? "启用" : "禁用"}
                    </button>
                    <button className="btn-danger text-xs py-1 px-2"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "删除邀请链接",
                          body: `确定删除 /join/${l.token.slice(0, 12)}…？\n已通过此链接发出的邀请不会被撤回，只是后续不能再用这个链接。`,
                          confirmText: "删除",
                          variant: "danger",
                        });
                        if (ok) del.mutate(l.token);
                      }}>删除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
