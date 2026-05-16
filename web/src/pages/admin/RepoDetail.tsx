import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, NavLink, Route, Routes, useParams } from "react-router-dom";
import { marked } from "marked";
import { api, fmtDate, fmtRelative } from "../../lib/api";
import Select from "../../components/Select";
import { useConfirm } from "../../components/ConfirmDialog";
import DiffView from "../../components/DiffView";

export default function RepoDetail() {
  const { org, repo } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["repo", org, repo],
    queryFn: () => api<any>(`/api/admin/${org}/repos/${repo}`),
    enabled: Boolean(repo),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  const branches: { name: string; protected: boolean }[] = data.branches;
  const defaultBranch: string = data.info.default_branch;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <Link to={`/admin/${org}/repos`} className="text-sm text-ink-500 hover:text-brand-500">← 仓库列表</Link>
      <header className="mt-3 mb-2 flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-ink-50 font-mono">{data.info.name}</h1>
        <span className={data.info.visibility === "private" ? "tag-yellow" : "tag-green"}>{data.info.visibility}</span>
        {data.info.archived && <span className="tag-gray">archived</span>}
        <a href={data.info.html_url} target="_blank" rel="noreferrer" className="ml-auto btn-ghost text-sm">在 GitHub 打开</a>
      </header>
      {data.info.description && <p className="text-ink-300 mb-4">{data.info.description}</p>}

      <nav className="flex flex-wrap items-center gap-1 border-b border-ink-800/60 mb-6 -mt-2">
        {[
          { slug: "", label: "代码", end: true },
          { slug: "commits", label: "Commits" },
          { slug: "issues", label: "Issues" },
          { slug: "pulls", label: "PRs" },
          { slug: "settings", label: "设置" },
        ].map((t) => (
          <NavLink key={t.slug} to={`/admin/${org}/repos/${repo}${t.slug ? "/" + t.slug : ""}`} end={t.end}
            className={({ isActive }) =>
              `px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
                isActive ? "border-brand-500 text-brand-500" : "border-transparent text-ink-300 hover:text-ink-100"
              }`}>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<CodeTab branches={branches} defaultBranch={defaultBranch} />} />
        <Route path="commits" element={<CommitsTab branches={branches} defaultBranch={defaultBranch} />} />
        <Route path="issues" element={<IssuesTab />} />
        <Route path="issues/:n" element={<IssueDetail />} />
        <Route path="pulls" element={<PullsTab />} />
        <Route path="pulls/:n" element={<PullDetail />} />
        <Route path="settings" element={<SettingsTab info={data.info} branches={branches} collaborators={data.collaborators} hooks={data.hooks} />} />
      </Routes>
    </div>
  );
}

function BranchPicker({ branches, value, onChange }: { branches: { name: string; protected: boolean }[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select size="sm" value={value} onChange={onChange}
      options={branches.map((b) => ({ value: b.name, label: b.name, hint: b.protected ? "protected" : undefined }))} />
  );
}

function CodeTab({ branches, defaultBranch }: { branches: any[]; defaultBranch: string }) {
  const { org, repo } = useParams();
  const [ref, setRef] = useState(defaultBranch);
  const [path, setPath] = useState("");
  const [file, setFile] = useState<string | null>(null);

  const tree = useQuery({
    queryKey: ["tree", org, repo, ref, path],
    queryFn: () => api<{ path: string; entries: any[] }>(`/api/admin/${org}/repos/${repo}/tree?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`),
    enabled: file === null,
  });
  const fileQ = useQuery({
    queryKey: ["file", org, repo, ref, file],
    queryFn: () => api<any>(`/api/admin/${org}/repos/${repo}/file?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(file!)}`),
    enabled: Boolean(file),
  });

  const crumbs = path.split("/").filter(Boolean);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-56"><BranchPicker branches={branches} value={ref} onChange={(v) => { setRef(v); setFile(null); }} /></div>
        <nav className="text-sm flex items-center gap-1 flex-wrap">
          <button onClick={() => { setPath(""); setFile(null); }} className="text-brand-500 font-mono hover:underline">{repo}</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-ink-600">/</span>
              <button onClick={() => { setPath(crumbs.slice(0, i + 1).join("/")); setFile(null); }}
                className="text-ink-200 font-mono hover:text-brand-500">{c}</button>
            </span>
          ))}
          {file && <><span className="text-ink-600">/</span><span className="text-ink-100 font-mono">{file.split("/").pop()}</span></>}
        </nav>
      </div>

      {file ? (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-ink-800/60 text-xs">
            <button onClick={() => setFile(null)} className="text-brand-500 hover:underline">← 返回目录</button>
            <span className="text-ink-500">{fileQ.data?.size ? `${fileQ.data.size} B` : ""}</span>
            {fileQ.data?.html_url && <a href={fileQ.data.html_url} target="_blank" className="text-ink-400 hover:text-brand-500 ml-auto">在 GitHub 打开</a>}
          </div>
          {fileQ.isLoading && <div className="p-6 text-ink-500">加载…</div>}
          {fileQ.data?.too_large && <div className="p-6 text-amber-400">文件超过 1MB，请在 GitHub 上查看</div>}
          {fileQ.data?.content !== undefined && !fileQ.data?.too_large && (
            <pre className="text-xs font-mono overflow-auto p-4 max-h-[70vh] leading-relaxed text-ink-200">{fileQ.data.content}</pre>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {tree.isLoading && <div className="p-6 text-ink-500">加载…</div>}
          {tree.error && <div className="p-6 text-rose-400">{(tree.error as Error).message}</div>}
          {tree.data && (
            <ul className="divide-y divide-ink-800/60">
              {path && (
                <li className="px-4 py-2.5 hover:bg-ink-800/30 cursor-pointer flex items-center gap-3 text-sm"
                  onClick={() => setPath(crumbs.slice(0, -1).join("/"))}>
                  <span className="text-ink-400 w-5">..</span>
                  <span className="text-ink-400">上一级</span>
                </li>
              )}
              {tree.data.entries.map((e) => (
                <li key={e.path}
                  onClick={() => { if (e.type === "dir") setPath(e.path); else setFile(e.path); }}
                  className="px-4 py-2.5 hover:bg-ink-800/30 cursor-pointer flex items-center gap-3 text-sm">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={`w-4 h-4 flex-shrink-0 ${e.type === "dir" ? "text-brand-500" : "text-ink-500"}`}>
                    {e.type === "dir"
                      ? <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                      : <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>}
                  </svg>
                  <span className="font-mono text-ink-200 flex-1">{e.name}</span>
                  {e.type === "file" && <span className="text-xs text-ink-500">{e.size}</span>}
                </li>
              ))}
              {tree.data.entries.length === 0 && <li className="p-6 text-center text-ink-500 text-sm">空目录</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CommitsTab({ branches, defaultBranch }: { branches: any[]; defaultBranch: string }) {
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

function IssuesTab() {
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
            <li key={i.number} className="px-5 py-3 hover:bg-ink-800/30">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${i.state === "open" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
                <Link to={`/admin/${org}/repos/${repo}/issues/${i.number}`} className="text-ink-100 font-medium hover:text-brand-500 flex-1 truncate">{i.title}</Link>
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
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MarkdownBox({ src }: { src: string | null }) {
  const html = useMemo(() => (src ? (marked.parse(src) as string) : ""), [src]);
  if (!src) return <p className="text-ink-500 text-sm italic">无正文</p>;
  return <div className="prose-doc text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}

function IssueDetail() {
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
    </div>
  );
}

function PullsTab() {
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
            <li key={p.number} className="px-5 py-3 hover:bg-ink-800/30">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${p.merged ? "bg-purple-500" : p.state === "open" ? "bg-emerald-500" : "bg-rose-500"}`}></span>
                <Link to={`/admin/${org}/repos/${repo}/pulls/${p.number}`} className="text-ink-100 font-medium hover:text-brand-500 flex-1 truncate">
                  {p.draft && <span className="text-xs text-ink-500 mr-2">[Draft]</span>}{p.title}
                </Link>
                <span className="text-xs text-ink-500">#{p.number}</span>
              </div>
              <div className="text-xs text-ink-500 mt-1 flex items-center gap-3 pl-5 flex-wrap">
                <span className="font-mono">@{p.user.login}</span>
                <span>{fmtRelative(p.updated_at)}</span>
                <span className="font-mono text-ink-400">{p.head} → {p.base}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PullDetail() {
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
          <h2 className="text-lg font-medium text-ink-100 mt-8 mb-3">改动 ({data.files.length} 文件)</h2>
          <div className="space-y-3">
            {data.files.map((f: any) => (
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
    </div>
  );
}

function SettingsTab({ info, branches, collaborators, hooks }: { info: any; branches: any[]; collaborators: any[]; hooks: any[] }) {
  const { org, repo } = useParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [newCollab, setNewCollab] = useState({ login: "", permission: "push" as "pull" | "triage" | "push" | "maintain" | "admin" });

  const addCollab = useMutation({
    mutationFn: () => api(`/api/admin/${org}/repos/${repo}/collaborators/${newCollab.login}`, {
      method: "PUT", body: JSON.stringify({ permission: newCollab.permission }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["repo", org, repo] }); setNewCollab({ login: "", permission: "push" }); },
  });
  const rmCollab = useMutation({
    mutationFn: (login: string) => api(`/api/admin/${org}/repos/${repo}/collaborators/${login}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repo", org, repo] }),
  });
  const delRepo = useMutation({
    mutationFn: () => api(`/api/admin/${org}/repos/${repo}`, { method: "DELETE" }),
    onSuccess: () => { window.location.href = `/admin/${org}/repos`; },
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
        <h2 className="font-semibold text-ink-100 mb-3">协作者 ({collaborators.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <input className="input md:col-span-2 font-mono text-sm" placeholder="GitHub 用户名"
            value={newCollab.login} onChange={(e) => setNewCollab({ ...newCollab, login: e.target.value })} />
          <Select value={newCollab.permission} onChange={(v) => setNewCollab({ ...newCollab, permission: v as any })}
            options={[
              { value: "pull", label: "pull (只读)" },
              { value: "triage", label: "triage" },
              { value: "push", label: "push (推荐)" },
              { value: "maintain", label: "maintain" },
              { value: "admin", label: "admin" },
            ]} />
        </div>
        <button className="btn-primary text-sm" disabled={!newCollab.login || addCollab.isPending}
          onClick={() => addCollab.mutate()}>添加协作者</button>
        {addCollab.error && <div className="text-rose-400 text-xs mt-2">{(addCollab.error as Error).message}</div>}

        <ul className="divide-y divide-ink-800/60 mt-4">
          {collaborators.map((c: any) => (
            <li key={c.login} className="flex items-center gap-3 py-2.5">
              <img src={c.avatar_url} alt="" className="w-7 h-7 rounded-full border border-ink-700/60" />
              <span className="flex-1 font-mono text-ink-200 text-sm">@{c.login}</span>
              <span className="tag-blue">{c.role}</span>
              <button className="btn-danger text-xs py-1 px-2"
                onClick={async () => {
                  const ok = await confirm({ title: `移除 @${c.login}？`, variant: "danger", confirmText: "移除" });
                  if (ok) rmCollab.mutate(c.login);
                }}>移除</button>
            </li>
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

      <div className="card p-5 border border-rose-500/40 bg-rose-500/5">
        <h2 className="font-semibold text-rose-300 mb-2">危险区</h2>
        <p className="text-sm text-ink-300 mb-3">删除仓库会**永久**删除代码、issue、PR、wiki、所有协作者关联。无法恢复。</p>
        <button className="btn-danger text-sm"
          onClick={async () => {
            const ok = await confirm({
              title: `删除仓库 ${org}/${repo}？`,
              body: `这将永久删除所有代码、issues、PRs、releases、wiki。无法恢复。请确认你已备份。`,
              confirmText: "我已了解，删除",
              variant: "danger",
            });
            if (ok) delRepo.mutate();
          }}>删除仓库</button>
      </div>
    </div>
  );
}
