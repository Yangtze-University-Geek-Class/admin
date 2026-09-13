import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate, fmtRelative } from "@shared/lib/api";
import { MarkdownBox } from "./Presentation";
import { IssueComposer } from "./Actions";

export function IssuesTab() {
  const { org, repo } = useParams();
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const { data, isLoading, error } = useQuery({
    queryKey: ["issues", org, repo, state],
    queryFn: () => api<{ issues: any[] }>(`/api/admin/${org}/repos/${repo}/issues?state=${state}`),
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
        {data && data.issues.length === 0 && <div className="p-8 text-center text-ink-500">无 issue</div>}
        <ul className="divide-y divide-ink-800/60">
          {data?.issues.map((i) => (
            <li key={i.number}>
              <Link to={`/admin/${org}/repos/${repo}/issues/${i.number}`} className="block px-5 py-3 hover:bg-ink-800/30 transition">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${i.state === "open" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
                  <div className="text-ink-100 font-medium flex-1 truncate">{i.title}</div>
                  <span className="text-xs text-ink-500">#{i.number}</span>
                </div>
                <div className="text-xs text-ink-500 mt-1 flex items-center gap-3 pl-5 flex-wrap">
                  <span className="font-mono">@{i.user.login}</span>
                  <span>{fmtRelative(i.created_at)}</span>
                  {i.comments > 0 && <span>{i.comments} 评论</span>}
                  {i.labels?.map((l: any) => (
                    <span key={l.name} className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ backgroundColor: `#${l.color}33`, color: `#${l.color}`, border: `1px solid #${l.color}66` }}>
                      {l.name}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function IssueDetail() {
  const { org, repo, n } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["issue", org, repo, n],
    queryFn: () => api<any>(`/api/admin/${org}/repos/${repo}/issues/${n}`),
  });
  if (isLoading) return <div className="text-ink-500">加载…</div>;
  if (error) return <div className="text-rose-400">{(error as Error).message}</div>;
  return (
    <div>
      <Link to={`/admin/${org}/repos/${repo}/issues`} className="text-sm text-brand-500 hover:underline">← Issues</Link>
      <header className="mt-3 mb-5">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <span className={`tag-${data.state === "open" ? "green" : "red"}`}>{data.state}</span>
          <h1 className="text-2xl font-semibold text-ink-50 flex-1">{data.title} <span className="text-ink-500">#{data.number}</span></h1>
          <a href={data.html_url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">GitHub</a>
        </div>
        <div className="text-xs text-ink-500 flex items-center gap-2 flex-wrap">
          {data.user.avatar_url && <img src={data.user.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
          <span className="font-mono">@{data.user.login}</span>
          <span>· {fmtDate(data.created_at)}</span>
          {data.labels?.map((l: any) => (
            <span key={l.name} className="px-1.5 py-0.5 rounded text-[10px]"
              style={{ backgroundColor: `#${l.color}33`, color: `#${l.color}`, border: `1px solid #${l.color}66` }}>{l.name}</span>
          ))}
        </div>
      </header>
      <div className="card p-5">
        <MarkdownBox src={data.body} />
      </div>
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
      <IssueComposer org={org!} repo={repo!} n={n!} queryKey={["issue", org, repo, n]} state={data.state} kind="issue" />
    </div>
  );
}
