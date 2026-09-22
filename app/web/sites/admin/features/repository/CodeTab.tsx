import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@shared/lib/api";
import { BranchPicker, CollapsibleFileBody } from "./Presentation";

export function CodeTab({ branches, defaultBranch }: { branches: any[]; defaultBranch: string }) {
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
            <CollapsibleFileBody content={fileQ.data.content} />
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
