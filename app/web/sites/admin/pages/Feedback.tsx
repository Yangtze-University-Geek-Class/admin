import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtDate, fmtRelative } from "@shared/lib/api";
import { useConfirm } from "@shared/ui/ConfirmDialog";
import Select from "@shared/ui/Select";

const STATUS_OPTS = [
  { value: "open",        label: "待处理" },
  { value: "triaged",     label: "已查看" },
  { value: "in_progress", label: "处理中" },
  { value: "done",        label: "已完成" },
  { value: "wont_do",     label: "不做" },
  { value: "spam",        label: "垃圾" },
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTS.map((s) => [s.value, s.label]));

export default function AdminFeedback() {
  const { org } = useParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<string>("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, { reply?: string; status?: string }>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["feedback", org, filter],
    queryFn: () => api<{ items: any[]; counts: Record<string, number> }>(
      `/api/admin/${org}/feedback${filter ? `?status=${filter}` : ""}`
    ),
  });

  const save = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      api(`/api/admin/${org}/feedback/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["feedback", org] }); setEditing(null); setDraft({}); },
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/admin/${org}/feedback/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback", org] }),
  });

  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  const counts = data!.counts;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">意见箱</h1>
        <p className="text-ink-500 text-sm mt-1">
          公开提交链接：<a href={`/feedback/${org}`} target="_blank" className="text-brand-500 font-mono">/feedback/{org}</a>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <FilterChip current={filter} value="" label="全部" count={total} onClick={setFilter} />
        {STATUS_OPTS.map((s) => (
          <FilterChip key={s.value} current={filter} value={s.value} label={s.label} count={counts[s.value] ?? 0} onClick={setFilter} />
        ))}
      </div>

      <div className="space-y-3">
        {data!.items.length === 0 && <div className="card p-10 text-center text-ink-500">无意见</div>}
        {data!.items.map((f) => {
          const isEdit = editing === f.id;
          const localDraft = draft[f.id] ?? { reply: f.reply ?? "", status: f.status };
          return (
            <div key={f.id} className="card p-5">
              <div className="flex items-center gap-2 flex-wrap text-xs mb-3">
                <span className="tag-blue">{f.category ?? "其他"}</span>
                <span className={statusTag(f.status)}>{STATUS_LABEL[f.status] ?? f.status}</span>
                <span className="text-ink-500">#{f.id}</span>
                {f.submitter_login && <span className="text-ink-400 font-mono">@{f.submitter_login}</span>}
                {f.contact && <span className="text-ink-400">联系: {f.contact}</span>}
                <span className="text-ink-500 ml-auto" title={fmtDate(f.created_at)}>{fmtRelative(f.created_at)}</span>
              </div>

              <p className="text-ink-100 whitespace-pre-wrap text-sm leading-relaxed">{f.content}</p>

              {f.reply && !isEdit && (
                <div className="mt-3 pl-3 border-l-2 border-brand-500/40 text-sm">
                  <div className="text-xs text-brand-500 mb-1">@{f.replied_by} 回复 · {fmtRelative(f.replied_at)}</div>
                  <p className="text-ink-200 whitespace-pre-wrap">{f.reply}</p>
                </div>
              )}

              {isEdit && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Select size="sm" value={localDraft.status ?? f.status}
                      onChange={(v) => setDraft({ ...draft, [f.id]: { ...localDraft, status: v } })}
                      options={STATUS_OPTS} />
                  </div>
                  <textarea className="input min-h-[100px]" placeholder="回复（选填，公开展示）"
                    value={localDraft.reply ?? ""}
                    onChange={(e) => setDraft({ ...draft, [f.id]: { ...localDraft, reply: e.target.value } })} />
                </div>
              )}

              <div className="flex items-center gap-2 mt-4">
                {isEdit ? (
                  <>
                    <button className="btn-primary text-xs py-1.5 px-3"
                      disabled={save.isPending}
                      onClick={() => save.mutate({ id: f.id, body: localDraft })}>
                      {save.isPending ? "保存中…" : "保存"}
                    </button>
                    <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => { setEditing(null); setDraft({}); }}>取消</button>
                  </>
                ) : (
                  <button className="btn-ghost text-xs py-1.5 px-3" onClick={() => setEditing(f.id)}>处理 / 回复</button>
                )}
                <button className="btn-danger text-xs py-1.5 px-3 ml-auto"
                  onClick={async () => {
                    const ok = await confirm({ title: `删除意见 #${f.id}？`, variant: "danger", confirmText: "删除" });
                    if (ok) del.mutate(f.id);
                  }}>删除</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const FilterChip = ({ current, value, label, count, onClick }: { current: string; value: string; label: string; count: number; onClick: (v: string) => void }) => (
  <button onClick={() => onClick(value)}
    className={`px-3 py-1.5 rounded-lg text-sm border transition ${
      current === value ? "bg-brand-500/15 text-brand-500 border-brand-500/40" : "text-ink-300 border-ink-700/60 hover:bg-ink-800/40"
    }`}>
    {label} <span className="ml-1 text-xs opacity-70">{count}</span>
  </button>
);

function statusTag(s: string) {
  if (s === "done") return "tag-green";
  if (s === "wont_do" || s === "spam") return "tag-red";
  if (s === "in_progress") return "tag-yellow";
  if (s === "triaged") return "tag-blue";
  return "tag-gray";
}
