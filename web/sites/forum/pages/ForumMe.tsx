import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { api } from "@shared/lib/api";
import { forumPath } from "@shared/lib/site";

type Me = {
  signed_in: boolean;
  user?: {
    id: number; username: string; display_name: string | null; avatar_url: string | null;
    email: string | null; signature: string | null; bio: string | null;
    has_password: boolean; has_github: boolean; github_login: string | null;
  };
};

export default function ForumMe() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["forum-me"], queryFn: () => api<Me>("/api/forum/me") });
  const u = me.data?.user;

  const [profile, setProfile] = useState({ display_name: "", signature: "", bio: "", email: "", avatar_url: "" });
  const [pw, setPw] = useState("");

  useEffect(() => {
    if (u) setProfile({
      display_name: u.display_name ?? "",
      signature: u.signature ?? "",
      bio: u.bio ?? "",
      email: u.email ?? "",
      avatar_url: u.avatar_url ?? "",
    });
  }, [u]);

  const saveProfile = useMutation({
    mutationFn: () => api(`/api/forum/me/profile`, { method: "PATCH", body: JSON.stringify(profile) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum-me"] }),
  });
  const setPassword = useMutation({
    mutationFn: () => api(`/api/forum/auth/set-password`, { method: "POST", body: JSON.stringify({ password: pw }) }),
    onSuccess: () => { setPw(""); qc.invalidateQueries({ queryKey: ["forum-me"] }); },
  });
  const unbindGithub = useMutation({
    mutationFn: () => api(`/api/forum/auth/github`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum-me"] }),
  });
  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/forum/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "upload_failed");
      setProfile({ ...profile, avatar_url: j.url });
      saveProfile.mutate();
      return j;
    },
  });

  if (me.isLoading) return <div className="max-w-3xl mx-auto px-6 py-12 text-ink-400">…</div>;
  if (!u) return <Navigate to="/login?return_to=/me" replace />;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-50">账号设置</h1>
        <p className="text-ink-300 text-sm mt-1">@{u.username}</p>
      </header>

      <section className="card p-6">
        <h2 className="font-semibold text-ink-50 mb-4">个人资料</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label text-sm">昵称</label>
            <input className="input" value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
          </div>
          <div>
            <label className="label text-sm">邮箱</label>
            <input type="email" className="input" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label text-sm">签名 · 一行</label>
            <input className="input" maxLength={120} value={profile.signature} onChange={(e) => setProfile({ ...profile, signature: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label text-sm">简介</label>
            <textarea rows={3} className="input resize-y" value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label text-sm">头像</label>
            <div className="flex items-center gap-4">
              {profile.avatar_url && <img src={profile.avatar_url} alt="" className="w-16 h-16 rounded-full border border-brand-500/15 object-cover" />}
              <label className="btn-ghost text-sm px-4 py-2 cursor-pointer">
                上传图片
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0]; if (f) uploadAvatar.mutate(f);
                }} />
              </label>
              {uploadAvatar.error && <span className="text-rose-500 text-xs">{(uploadAvatar.error as Error).message}</span>}
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          {saveProfile.error && <div className="text-rose-500 text-sm mr-auto">{(saveProfile.error as Error).message}</div>}
          {saveProfile.isSuccess && <div className="text-emerald-600 text-sm mr-auto">已保存</div>}
          <button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending} className="btn-primary text-sm px-5 py-2 disabled:opacity-50">
            {saveProfile.isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold text-ink-50 mb-4">账号绑定与密码</h2>
        <div className="flex items-center justify-between py-3 border-b border-brand-500/10">
          <div>
            <div className="text-sm text-ink-100 font-medium">GitHub</div>
            <div className="text-xs text-ink-400 mt-0.5">
              {u.github_login ? `已绑定 @${u.github_login}` : "未绑定 — 绑定后可一键登录"}
            </div>
          </div>
          {u.github_login ? (
            <button onClick={() => unbindGithub.mutate()} disabled={unbindGithub.isPending || !u.has_password}
              className="btn-ghost text-sm px-3 py-1.5 disabled:opacity-50"
              title={!u.has_password ? "请先设置密码" : ""}>
              解绑
            </button>
          ) : (
            <a href={`/auth/forum/github?bind=1&return_to=${encodeURIComponent(`${window.location.origin}${forumPath("/me")}`)}`} className="btn-primary text-sm px-3 py-1.5">绑定</a>
          )}
        </div>
        <div className="py-4">
          <div className="text-sm text-ink-100 font-medium mb-2">{u.has_password ? "修改密码" : "设置密码"}</div>
          <div className="flex items-center gap-2">
            <input type="password" placeholder="至少 6 位" className="input flex-1" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} />
            <button onClick={() => setPassword.mutate()} disabled={setPassword.isPending || pw.length < 6} className="btn-primary text-sm px-4 py-2 disabled:opacity-50">
              {setPassword.isPending ? "保存中…" : "保存"}
            </button>
          </div>
          {setPassword.error && <div className="text-rose-500 text-xs mt-2">{(setPassword.error as Error).message}</div>}
          {setPassword.isSuccess && <div className="text-emerald-600 text-xs mt-2">密码已更新</div>}
        </div>
      </section>

      <div className="flex items-center justify-between text-sm">
        <Link to="/" className="text-ink-300 hover:text-brand-500">← 返回论坛</Link>
        <Link to="/me/notifications" className="text-brand-500 hover:underline">通知中心 →</Link>
      </div>
    </div>
  );
}
