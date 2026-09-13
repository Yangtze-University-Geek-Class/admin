import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@shared/lib/api";
import Select from "@shared/ui/Select";
import { useConfirm } from "@shared/ui/ConfirmDialog";

export function IssueComposer({ org, repo, n, queryKey, state, kind }: { org: string; repo: string; n: string; queryKey: any[]; state: "open" | "closed"; kind: "issue" | "pr" }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [body, setBody] = useState("");
  const addComment = useMutation({
    mutationFn: () => api(`/api/admin/${org}/repos/${repo}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey }); },
  });
  const toggleState = useMutation({
    mutationFn: (target: "open" | "closed") => api(`/api/admin/${org}/repos/${repo}/issues/${n}`, { method: "PATCH", body: JSON.stringify({ state: target }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const label = kind === "pr" ? "PR" : "issue";
  return (
    <div className="card p-4 mt-4">
      <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="评论 · 支持 Markdown" className="input font-mono text-sm resize-y w-full" />
      <div className="flex items-center justify-end gap-2 mt-3">
        {addComment.error && <div className="text-rose-400 text-xs mr-auto">{(addComment.error as Error).message}</div>}
        {toggleState.error && <div role="alert" className="text-rose-400 text-xs">{(toggleState.error as Error).message}</div>}
        {state === "open" ? (
          <button onClick={async () => {
            const ok = await confirm({ title: `关闭${label}`, body: `确认关闭 #${n}？`, confirmText: "关闭" });
            if (!ok) return;
            try {
              if (body.trim()) await addComment.mutateAsync();
              await toggleState.mutateAsync("closed");
            } catch { /* mutation errors render in the form */ }
          }} disabled={addComment.isPending || toggleState.isPending} className="btn-ghost text-sm px-4 py-2">{body.trim() ? "评论并关闭" : "关闭"}</button>
        ) : (
          <button onClick={async () => {
            try {
              if (body.trim()) await addComment.mutateAsync();
              await toggleState.mutateAsync("open");
            } catch { /* mutation errors render in the form */ }
          }} disabled={addComment.isPending || toggleState.isPending} className="btn-ghost text-sm px-4 py-2">{body.trim() ? "评论并重开" : "重开"}</button>
        )}
        <button onClick={() => addComment.mutate()} disabled={!body.trim() || addComment.isPending}
          className="btn-primary text-sm px-5 py-2 disabled:opacity-50">
          {addComment.isPending ? "提交…" : "评论"}
        </button>
      </div>
    </div>
  );
}

export function MergeBox({ org, repo, n, head, base, sha, queryKey }: { org: string; repo: string; n: string; head: string; base: string; sha: string; queryKey: any[] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("merge");
  const merge = useMutation({
    mutationFn: () => api(`/api/admin/${org}/repos/${repo}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: method, sha }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  return (
    <div className="card p-4 mt-4 border-emerald-500/30 bg-emerald-500/5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-sm text-ink-100">
          合并 <code className="font-mono text-brand-500">{head}</code> → <code className="font-mono text-brand-500">{base}</code>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-36">
            <Select value={method} onChange={(v) => setMethod(v as any)} options={[
              { value: "merge", label: "Create merge commit" },
              { value: "squash", label: "Squash and merge" },
              { value: "rebase", label: "Rebase and merge" },
            ]} />
          </div>
          <button onClick={async () => {
            const ok = await confirm({ title: "合并 PR", body: `用 ${method} 方式合并 ${head} → ${base}？`, confirmText: "合并" });
            if (ok) merge.mutate();
          }} disabled={merge.isPending} className="btn-primary text-sm px-5 py-2 disabled:opacity-50">
            {merge.isPending ? "合并中…" : "合并"}
          </button>
        </div>
      </div>
      {merge.error && <div className="text-rose-400 text-xs mt-2">{(merge.error as Error).message}</div>}
    </div>
  );
}
