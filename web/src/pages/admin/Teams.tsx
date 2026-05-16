import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";

export default function Teams() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["teams"],
    queryFn: () => api<{ teams: any[] }>("/api/admin/teams"),
  });

  const [form, setForm] = useState({ name: "", description: "", privacy: "closed" as "closed" | "secret" });
  const create = useMutation({
    mutationFn: () => api("/api/admin/teams", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["teams"] }); setForm({ name: "", description: "", privacy: "closed" }); },
  });
  const del = useMutation({
    mutationFn: (slug: string) => api(`/api/admin/teams/${slug}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });

  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-8">
      <header><h1 className="text-2xl font-semibold text-ink-50">团队</h1></header>

      <div className="card p-5">
        <h2 className="font-semibold text-ink-100 mb-4">新建团队</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="input md:col-span-1" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input md:col-span-2" placeholder="描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <select className="input md:col-span-1" value={form.privacy} onChange={(e) => setForm({ ...form, privacy: e.target.value as any })}>
            <option value="closed">closed</option>
            <option value="secret">secret</option>
          </select>
        </div>
        <button className="btn-primary mt-3" disabled={!form.name || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "创建中…" : "创建"}
        </button>
        {create.error && <div className="text-rose-400 text-sm mt-2">{(create.error as Error).message}</div>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data!.teams.length === 0 && (
          <div className="card p-8 text-center text-ink-500 md:col-span-2">还没有团队</div>
        )}
        {data!.teams.map((t: any) => (
          <div key={t.slug} className="card p-5">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-ink-100">{t.name}</h3>
                <div className="text-xs text-ink-500 font-mono">slug={t.slug}</div>
                {t.description && <p className="text-sm text-ink-400 mt-2">{t.description}</p>}
                <div className="mt-3 flex items-center gap-3 text-xs text-ink-500">
                  <span>{t.member_count} 成员</span>
                  <span>{t.repo_count} 仓库</span>
                  <span className="tag-gray">{t.privacy}</span>
                </div>
              </div>
              <button className="btn-danger text-xs py-1 px-2"
                onClick={() => { if (confirm(`删除团队 ${t.name}?`)) del.mutate(t.slug); }}>删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
