import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api, fmtRelative } from "../../lib/api";

export default function Activity() {
  const { org } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["activity", org],
    queryFn: () => api<{ events: any[] }>(`/api/admin/${org}/activity`),
  });
  if (isLoading) return <div className="p-8 text-ink-500">加载中…</div>;
  if (error) return <div className="p-8 text-rose-400">{(error as Error).message}</div>;

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">
      <header className="mb-6"><h1 className="text-2xl font-semibold text-ink-50">活动流</h1></header>
      <div className="card divide-y divide-ink-800/60">
        {data!.events.length === 0 && <div className="p-8 text-center text-ink-500">暂无活动</div>}
        {data!.events.map((e) => (
          <div key={e.id} className="flex items-center gap-4 px-5 py-3 hover:bg-ink-800/30">
            <img src={e.actor_avatar} alt="" className="w-8 h-8 rounded-full border border-ink-700/60" />
            <div className="flex-1 min-w-0 text-sm">
              <div className="text-ink-200">
                <span className="font-mono">@{e.actor}</span>
                <span className="text-ink-500 mx-2">{e.payload_summary}</span>
                {e.repo && <span className="font-mono text-brand-500">{e.repo}</span>}
              </div>
              <div className="text-xs text-ink-500 mt-0.5">{fmtRelative(e.created_at)}</div>
            </div>
            <span className="tag-gray text-[10px]">{e.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
