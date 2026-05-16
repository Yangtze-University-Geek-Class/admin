import { Link, useLocation } from "react-router-dom";

export default function Done() {
  const state = (useLocation().state ?? {}) as { message?: string; deferred?: boolean };
  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12">
      <div className="card max-w-lg w-full p-10 text-center">
        <div className={`inline-flex w-14 h-14 rounded-full items-center justify-center mb-5 ${state.deferred ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-7 h-7">
            {state.deferred
              ? <path d="M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />
              : <path d="m5 12 5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-ink-50 mb-2">
          {state.deferred ? "已记录，等待处理" : "邀请已发送"}
        </h2>
        <p className="text-ink-400 leading-relaxed">{state.message ?? "你的申请已经处理。"}</p>
        <Link to="/" className="btn-ghost mt-8">返回</Link>
      </div>
    </div>
  );
}
