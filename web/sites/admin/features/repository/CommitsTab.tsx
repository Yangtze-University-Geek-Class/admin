import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtRelative } from "@shared/lib/api";
import DiffView from "@shared/ui/DiffView";
import { BranchPicker } from "./Presentation";

export function CommitsTab({ branches, defaultBranch }: { branches: any[]; defaultBranch: string }) {
  const { org, repo } = useParams();
  const [ref, setRef] = useState(defaultBranch);
  const [open, setOpen] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["commits", org, repo, ref],
    queryFn: () => api<{ commits: any[] }>(`/api/admin/${org}/repos/${repo}/commits?sha=${encodeURIComponent(ref)}&per_page=50`),
  });
  const detail = useQuery({
    queryKey: ["commit-detail", org, repo, open],
    queryFn: () => api<any>(`/api/admin/${org}/repos/${repo}/commits/${open}`),
    enabled: Boolean(open),
  });

  if (open) {
    return (
      <div>
        <button onClick={() => setOpen(null)} className="text-sm text-brand-500 hover:underline mb-4">← Commits</button>
        {detail.isLoading && <div className="text-ink-500">加载…</div>}
        {detail.data && (
          <>
            <div className="card p-5 mb-4">
              <h3 className="text-lg font-medium text-ink-100 whitespace-pre-wrap">{detail.data.message}</h3>
              <div className="text-xs text-ink-500 mt-2 flex items-center gap-2">
                {detail.data.actor?.avatar_url && <img src={detail.data.actor.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
                <span className="font-mono">{detail.data.actor?.login ?? detail.data.author.name}</span>
                <span>· {fmtRelative(detail.data.author.date)}</span>
                <span className="ml-auto font-mono text-ink-400">{open?.slice(0, 7)}</span>
              </div>
              <div className="text-xs text-ink-400 mt-3 flex gap-4">
                <span><span className="text-emerald-400">+{detail.data.stats?.additions ?? 0}</span></span>
                <span><span className="text-rose-400">-{detail.data.stats?.deletions ?? 0}</span></span>
                <span>{detail.data.files?.length ?? 0} 个文件</span>
              </div>
            </div>
            <div className="space-y-3">
              {detail.data.files?.map((f: any) => (
                <div key={f.filename} className="card overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-ink-900/40 border-b border-ink-800/60 text-sm">
                    <span className={`tag-${f.status === "added" ? "green" : f.status === "removed" ? "red" : "blue"}`}>{f.status}</span>
                    <span className="font-mono text-ink-200 flex-1 truncate">{f.filename}</span>
                    <span className="text-emerald-400 text-xs">+{f.additions}</span>
                    <span className="text-rose-400 text-xs">-{f.deletions}</span>
                  </div>
                  <DiffView patch={f.patch} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-56"><BranchPicker branches={branches} value={ref} onChange={setRef} /></div>
        <span className="text-sm text-ink-500">{list.data?.commits.length ?? 0} 条 commit</span>
      </div>
      <div className="card overflow-hidden">
        {list.isLoading && <div className="p-6 text-ink-500">加载…</div>}
        {list.error && <div className="p-6 text-rose-400">{(list.error as Error).message}</div>}
        <ul className="divide-y divide-ink-800/60">
          {list.data?.commits.map((c) => (
            <li key={c.sha} onClick={() => setOpen(c.sha)}
              className="flex items-center gap-4 px-5 py-3 hover:bg-ink-800/30 cursor-pointer">
              {c.actor?.avatar_url && <img src={c.actor.avatar_url} alt="" className="w-7 h-7 rounded-full border border-ink-700/60" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink-100 truncate">{c.message}</div>
                <div className="text-xs text-ink-500 mt-0.5">
                  <span className="font-mono">{c.actor?.login ?? c.author.name}</span>
                  <span> · {fmtRelative(c.author.date)}</span>
                </div>
              </div>
              <code className="text-xs text-ink-400 font-mono">{c.short_sha}</code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
