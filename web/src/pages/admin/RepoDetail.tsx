import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, fmtRelative } from "../../lib/api";

export default function RepoDetail() {
  const { repo } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["repo", repo],
    queryFn: () => api<any>(`/api/admin/repos/${repo}`),
    enabled: Boolean(repo),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto">
      <Link to="/admin/repos" className="text-sm text-ink-500 hover:text-brand-500">← 仓库列表</Link>
      <header className="mt-3 mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink-50 font-mono">{data.info.name}</h1>
        <span className={data.info.visibility === "private" ? "tag-yellow" : "tag-green"}>{data.info.visibility}</span>
        <a href={data.info.html_url} target="_blank" rel="noreferrer" className="ml-auto btn-ghost text-sm">在 GitHub 打开</a>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card p-5">
          <h2 className="font-semibold text-ink-100 mb-3">分支 ({data.branches.length})</h2>
          <ul className="space-y-2 max-h-96 overflow-auto">
            {data.branches.map((b: any) => (
              <li key={b.name} className="flex items-center justify-between text-sm">
                <span className="font-mono text-ink-200">{b.name}</span>
                {b.protected ? <span className="tag-green">protected</span> : <span className="tag-gray">open</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold text-ink-100 mb-3">协作者 ({data.collaborators.length})</h2>
          <ul className="space-y-2 max-h-96 overflow-auto">
            {data.collaborators.map((c: any) => (
              <li key={c.login} className="flex items-center gap-3">
                <img src={c.avatar_url} alt="" className="w-7 h-7 rounded-full border border-ink-700/60" />
                <span className="flex-1 font-mono text-ink-200 text-sm">@{c.login}</span>
                <span className="tag-blue">{c.role}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-ink-100 mb-3">Webhooks ({data.hooks.length})</h2>
          {data.hooks.length === 0 ? <p className="text-ink-500 text-sm">无</p> : (
            <ul className="space-y-2">
              {data.hooks.map((h: any) => (
                <li key={h.id} className="text-sm flex items-center gap-3">
                  <span className={h.active ? "tag-green" : "tag-gray"}>{h.active ? "active" : "off"}</span>
                  <span className="font-mono text-ink-200 truncate">{h.url ?? h.name}</span>
                  <span className="text-ink-500 text-xs">{h.events?.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-ink-100 mb-3">最近 push</h2>
          <div className="text-sm text-ink-300">{fmtRelative(data.info.pushed_at)} 到 <span className="font-mono">{data.info.default_branch}</span></div>
        </section>
      </div>
    </div>
  );
}
