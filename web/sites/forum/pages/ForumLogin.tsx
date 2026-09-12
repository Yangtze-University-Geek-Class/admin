import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@shared/lib/api";
import { forumPath } from "@shared/lib/site";
import BackBar from "@shared/ui/BackBar";

export default function ForumLogin() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const rawReturnTo = params.get("return_to") ?? "/";
  const navReturnTo = /^https?:\/\//.test(rawReturnTo)
    ? new URL(rawReturnTo).pathname + new URL(rawReturnTo).search
    : rawReturnTo;
  const oauthReturnTo = /^https?:\/\//.test(rawReturnTo)
    ? rawReturnTo
    : `${window.location.origin}${forumPath(rawReturnTo.startsWith("/") ? rawReturnTo : "/" + rawReturnTo)}`;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = useMutation({
    mutationFn: () => api(`/api/forum/auth/login`, { method: "POST", body: JSON.stringify({ username, password }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["forum-me"] }); nav(navReturnTo); },
  });

  return (
    <div className="max-w-md mx-auto px-6 py-10">
      <BackBar label="返回" />
      <h1 className="text-2xl font-bold text-ink-50 mb-1">登录</h1>
      <p className="text-ink-300 text-sm mb-6">
        新成员可<Link to={`/register?return_to=${encodeURIComponent(navReturnTo)}`} className="text-brand-500 hover:underline">注册账号</Link>，
        或使用 GitHub 一键登录。老论坛账号继续用原用户名 + 密码即可。
      </p>

      <div className="card p-6">
        <a href={`/auth/forum/github?return_to=${encodeURIComponent(oauthReturnTo)}`}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-ink-50 text-ink-950 hover:opacity-90 transition text-sm font-medium">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.11.78-.25.78-.55v-1.95c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 015.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.79.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
          用 GitHub 登录
        </a>
        <div className="flex items-center gap-3 my-5 text-xs text-ink-400">
          <div className="flex-1 h-px bg-brand-500/15" />
          <span>或用账号密码（兼容老论坛）</span>
          <div className="flex-1 h-px bg-brand-500/15" />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); submit.mutate(); }} className="space-y-3">
          <div>
            <label className="label text-sm">用户名 / 邮箱</label>
            <input autoFocus className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <label className="label text-sm">密码</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {submit.error && <div className="text-rose-500 text-sm">{(submit.error as Error).message}</div>}
          <button type="submit" disabled={submit.isPending || !username || !password}
            className="btn-primary w-full py-2.5 mt-2 disabled:opacity-50">
            {submit.isPending ? "登录中…" : "登录"}
          </button>
        </form>
      </div>

      <p className="text-xs text-ink-400 mt-4 text-center">
        老论坛用户名格式如 <code className="font-mono text-brand-500">qq用户xxx-abc</code> 或原始用户名，登录后可在「账号设置」绑定 GitHub。
      </p>
    </div>
  );
}
