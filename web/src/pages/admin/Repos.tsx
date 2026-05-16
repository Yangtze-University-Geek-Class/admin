import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, fmtRelative } from "../../lib/api";

export default function Repos() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["repos"],
    queryFn: () => api<{ repos: any[] }>("/api/admin/repos"),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-ink-50">仓库</h1>
        <span className="text-ink-500 text-sm">{data!.repos.length} 个</span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data!.repos.map((r) => (
          <Link key={r.full_name} to={`/admin/repos/${r.name}`} className="card p-5 hover:border-brand-500/50 transition group">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-ink-100 group-hover:text-brand-500 font-medium truncate">{r.name}</span>
                  <span className={r.visibility === "private" ? "tag-yellow" : "tag-green"}>{r.visibility}</span>
                  {r.archived && <span className="tag-gray">archived</span>}
                </div>
                <div className="text-xs text-ink-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>默认 <span className="font-mono text-ink-300">{r.default_branch}</span></span>
                  <span>{(r.size_kb / 1024).toFixed(1)} MB</span>
                  {r.language && <span>{r.language}</span>}
                  <span>star {r.stargazers_count}</span>
                  <span>issue {r.open_issues_count}</span>
                  <span>updated {fmtRelative(r.pushed_at)}</span>
                </div>
              </div>
            </div>
            {r.topics?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {r.topics.slice(0, 6).map((t: string) => <span key={t} className="tag-blue text-[10px]">{t}</span>)}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
