import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate, fmtRelative } from "@shared/lib/api";
import { CollapsibleFile, FilesBulkToggle, MarkdownBox } from "./Presentation";
import { IssueComposer, MergeBox } from "./Actions";

export function PullsTab() {
  const { org, repo } = useParams();
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const { data, isLoading, error } = useQuery({
    queryKey: ["pulls", org, repo, state],
    queryFn: () => api<{ pulls: any[] }>(`/api/admin/${org}/repos/${repo}/pulls?state=${state}`),
  });
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {(["open", "closed", "all"] as const).map((s) => (
          <button key={s} onClick={() => setState(s)}
            className={`px-3 py-1.5 text-sm rounded-lg border ${
              state === s ? "bg-brand-500/15 text-brand-500 border-brand-500/40" : "border-ink-700/60 text-ink-300 hover:bg-ink-800/40"
            }`}>{s}</button>
        ))}
      </div>
      {isLoading && <div className="text-ink-500">加载…</div>}
      {error && <div className="text-rose-400">{(error as Error).message}</div>}
      <div className="card overflow-hidden">
        {data && data.pulls.length === 0 && <div className="p-8 text-center text-ink-500">无 PR</div>}
        <ul className="divide-y divide-ink-800/60">
          {data?.pulls.map((p) => (
            <li key={p.number}>
              <Link to={`/admin/${org}/repos/${repo}/pulls/${p.number}`} className="block px-5 py-3 hover:bg-ink-800/30 transition">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${p.merged ? "bg-purple-500" : p.state === "open" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
                  <div className="text-ink-100 font-medium flex-1 truncate">
                    {p.draft && <span className="text-xs text-ink-500 mr-2">[Draft]</span>}{p.title}
                  </div>
                  <span className="text-xs text-ink-500">#{p.number}</span>
                </div>
                <div className="text-xs text-ink-500 mt-1 flex items-center gap-3 pl-5 flex-wrap">
                  <span className="font-mono">@{p.user.login}</span>
                  <span>{fmtRelative(p.updated_at)}</span>
                  <span className="font-mono text-ink-400">{p.head} → {p.base}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PullDetail() {
  const { org, repo, n } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["pull", org, repo, n],
    queryFn: () => api<any>(`/api/admin/${org}/repos/${repo}/pulls/${n}`),
  });
  if (isLoading) return <div className="text-ink-500">加载…</div>;
  if (error) return <div className="text-rose-400">{(error as Error).message}</div>;
  const stateTag = data.merged ? "tag-blue" : data.state === "open" ? "tag-green" : "tag-red";
  return (
    <div>
      <Link to={`/admin/${org}/repos/${repo}/pulls`} className="text-sm text-brand-500 hover:underline">← PRs</Link>
      <header className="mt-3 mb-5">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <span className={stateTag}>{data.merged ? "merged" : data.state}</span>
          {data.draft && <span className="tag-gray">draft</span>}
          <h1 className="text-2xl font-semibold text-ink-50 flex-1">{data.title} <span className="text-ink-500">#{data.number}</span></h1>
          <a href={data.html_url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">GitHub</a>
        </div>
        <div className="text-xs text-ink-500 flex items-center gap-2 flex-wrap">
          {data.user.avatar_url && <img src={data.user.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
          <span className="font-mono">@{data.user.login}</span>
          <span>· {fmtDate(data.created_at)}</span>
          <span className="font-mono text-ink-400">{data.head.ref} → {data.base.ref}</span>
          <span className="text-emerald-400">+{data.additions}</span>
          <span className="text-rose-400">-{data.deletions}</span>
          <span>{data.changed_files} 个文件</span>
        </div>
      </header>
      <div className="card p-5">
        <MarkdownBox src={data.body} />
      </div>

      {data.files?.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-8 mb-3">
            <h2 className="text-lg font-medium text-ink-100">改动 ({data.files.length} 文件)</h2>
            <FilesBulkToggle filesCount={data.files.length} />
          </div>
          <div className="space-y-3">
            {data.files.map((f: any, idx: number) => (
              <CollapsibleFile key={f.filename} file={f} defaultOpen={data.files.length <= 3 || idx === 0} />
            ))}
          </div>
        </>
      )}

      <h2 className="text-lg font-medium text-ink-100 mt-8 mb-3">评论 ({data.comments.length})</h2>
      <div className="space-y-3">
        {data.comments.map((c: any) => (
          <div key={c.id} className="card p-4">
            <div className="flex items-center gap-2 mb-2 text-xs text-ink-500">
              {c.user.avatar_url && <img src={c.user.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
              <span className="font-mono">@{c.user.login}</span>
              <span>· {fmtRelative(c.created_at)}</span>
            </div>
            <MarkdownBox src={c.body} />
          </div>
        ))}
        {data.comments.length === 0 && <p className="text-ink-500 text-sm">暂无评论</p>}
      </div>
      {data.state === "open" && !data.merged && data.mergeable !== false && (
        <MergeBox org={org!} repo={repo!} n={n!} head={data.head.ref} base={data.base.ref} sha={data.head.sha} queryKey={["pull", org, repo, n]} />
      )}
      {data.state === "open" && data.mergeable === false && (
        <div className="card p-4 mt-4 border-rose-500/30 bg-rose-500/5 text-sm text-rose-300">
          PR 当前不可自动合并（有冲突或缺 review）。请在 GitHub 上解决冲突后再回来。
        </div>
      )}
      <IssueComposer org={org!} repo={repo!} n={n!} queryKey={["pull", org, repo, n]} state={data.merged ? "closed" : data.state} kind="pr" />
    </div>
  );
}
