import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Route, Routes, useParams } from "react-router-dom";
import { api } from "@shared/lib/api";
import { CodeTab } from "../features/repository/CodeTab";
import { CommitsTab } from "../features/repository/CommitsTab";
import { IssueDetail, IssuesTab } from "../features/repository/Issues";
import { PullDetail, PullsTab } from "../features/repository/Pulls";
import { SettingsTab } from "../features/repository/SettingsTab";

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
