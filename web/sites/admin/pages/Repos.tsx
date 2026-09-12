import { useQuery } from "@tanstack/react-query";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { api, fmtRelative } from "@shared/lib/api";

type Ctx = { isAdmin: boolean };

export default function Repos() {
  const { org } = useParams();
  const ctx = useOutletContext<Ctx>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["repos", org],
    queryFn: () => api<{ repos: any[] }>(`/api/admin/${org}/repos`),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-ink-50">仓库</h1>
        <span className="text-ink-500 text-sm">{data!.repos.length} 个</span>
        {ctx?.isAdmin && (
          <Link to={`/admin/${org}/repos/new`} className="btn-primary text-sm ml-auto">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4"><path d="M12 5v14M5 12h14" /></svg>
            新建仓库
          </Link>
        )}
      </header>

      {data!.repos.length === 0 ? (
        <div className="card p-10 text-center text-ink-500">该组织还没有任何仓库</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data!.repos.map((r) => (
            <Link key={r.full_name} to={`/admin/${org}/repos/${r.name}`} className="card p-5 hover:border-brand-500/50 transition group">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-ink-100 group-hover:text-brand-500 font-medium truncate">{r.name}</span>
                <span className={r.visibility === "private" ? "tag-yellow" : "tag-green"}>{r.visibility}</span>
                {r.archived && <span className="tag-gray">archived</span>}
              </div>
              {r.description && <p className="text-sm text-ink-400 mb-2 line-clamp-2">{r.description}</p>}
              <div className="text-xs text-ink-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>默认 <span className="font-mono text-ink-300">{r.default_branch}</span></span>
                <span>{(r.size_kb / 1024).toFixed(1)} MB</span>
                {r.language && <span>{r.language}</span>}
                <span>star {r.stargazers_count}</span>
                <span>issue {r.open_issues_count}</span>
                <span>updated {fmtRelative(r.pushed_at)}</span>
              </div>
              {r.topics?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {r.topics.slice(0, 6).map((t: string) => <span key={t} className="tag-blue text-[10px]">{t}</span>)}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
