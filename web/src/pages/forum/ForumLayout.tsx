import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { applyTheme } from "../../lib/themes";
import ThemeSwitcher from "../../components/ThemeSwitcher";

type Me = { signed_in: boolean; user?: { id: number; username: string; display_name: string | null; avatar_url: string | null; role: string; has_password: boolean; has_github: boolean } };

export default function ForumLayout() {
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("theme")) applyTheme("yzgc-blue");
  }, []);

  const me = useQuery({ queryKey: ["forum-me"], queryFn: () => api<Me>("/api/forum/me") });
  const u = me.data?.user;

  const logout = async () => {
    await api("/api/forum/auth/logout", { method: "POST" });
    qc.invalidateQueries({ queryKey: ["forum-me"] });
    nav("/forum");
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-brand-500/15">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-ink-50 shrink-0">
            <img src="/logo.png" alt="" className="w-7 h-7 rounded" />
            <span className="font-semibold text-sm hidden sm:inline">YUGC 论坛</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm ml-2">
            <ForumNav to="/forum" end>首页</ForumNav>
            <ForumNav to="/forum/categories">分类</ForumNav>
            {u && <ForumNav to="/forum/new">发帖</ForumNav>}
          </nav>
          <form className="ml-auto hidden md:flex" onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q") as string;
            if (q?.trim()) nav(`/forum?q=${encodeURIComponent(q.trim())}`);
          }}>
            <input name="q" placeholder="搜帖子标题…" className="input text-sm h-8 w-56" defaultValue={new URLSearchParams(loc.search).get("q") ?? ""} />
          </form>
          <div className="flex items-center gap-2 ml-2">
            <ThemeSwitcher compact />
            {!me.data && <span className="text-ink-400 text-xs">…</span>}
            {me.data && !u && (
              <>
                <Link to="/forum/login" className="btn-ghost text-sm py-1.5 px-3">登录</Link>
                <Link to="/forum/register" className="btn-primary text-sm py-1.5 px-3">注册</Link>
              </>
            )}
            {u && (
              <div className="relative">
                <button onClick={() => setMenuOpen(!menuOpen)} className="flex items-center gap-2 hover:bg-brand-500/8 rounded-full pl-1 pr-3 py-1 transition">
                  <Avatar user={u} size={28} />
                  <span className="text-sm text-ink-100 max-w-[90px] truncate">{u.display_name ?? u.username}</span>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-56 card p-1 z-50 shadow-lg">
                      <MenuLink to={`/forum/u/${u.username}`} onClick={() => setMenuOpen(false)}>我的主页</MenuLink>
                      <MenuLink to="/forum/me" onClick={() => setMenuOpen(false)}>账号设置</MenuLink>
                      <MenuLink to="/forum/me/notifications" onClick={() => setMenuOpen(false)}>通知中心</MenuLink>
                      {(u.role === "admin" || u.role === "mod") && (
                        <MenuLink to="/forum/admin" onClick={() => setMenuOpen(false)}>论坛管理</MenuLink>
                      )}
                      <div className="border-t border-brand-500/10 my-1" />
                      <button onClick={logout} className="w-full text-left px-3 py-2 text-sm text-ink-100 hover:bg-brand-500/8 rounded transition">退出登录</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

function ForumNav({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) =>
      `px-3 py-1.5 rounded transition ${isActive ? "bg-brand-500/15 text-brand-500 font-medium" : "text-ink-200 hover:text-brand-500 hover:bg-brand-500/8"}`
    }>{children}</NavLink>
  );
}

function MenuLink({ to, onClick, children }: { to: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link to={to} onClick={onClick} className="block px-3 py-2 text-sm text-ink-100 hover:bg-brand-500/8 rounded transition">{children}</Link>
  );
}

export function Avatar({ user, size = 32 }: { user: { username: string; display_name: string | null; avatar_url: string | null }; size?: number }) {
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt="" className="rounded-full object-cover border border-brand-500/15" style={{ width: size, height: size }} />;
  }
  const initials = (user.display_name ?? user.username).slice(0, 2).toUpperCase();
  return (
    <div
      className="rounded-full bg-brand-500/15 text-brand-500 font-semibold flex items-center justify-center border border-brand-500/20"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >{initials}</div>
  );
}
