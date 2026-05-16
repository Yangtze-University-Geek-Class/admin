import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import ThemeSwitcher from "../../components/ThemeSwitcher";
import { externalUrl } from "../../lib/site";

type Me = {
  signed_in: boolean;
  user?: {
    id: number;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    role: string;
    has_password: boolean;
    has_github: boolean;
    groups?: { id: number; name: string; is_default: number }[];
    permissions?: string[];
  };
};

export default function ForumLayout() {
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem("forum-bind-banner-dismissed") === "1"; } catch { return false; }
  });

  const me = useQuery({ queryKey: ["forum-me"], queryFn: () => api<Me>("/api/forum/me") });
  const u = me.data?.user;

  const logout = async () => {
    await api("/api/forum/auth/logout", { method: "POST" });
    qc.invalidateQueries({ queryKey: ["forum-me"] });
    nav("/");
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 bg-ink-950/85 backdrop-blur border-b border-brand-500/15">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 text-ink-50 shrink-0">
            <img src="/logo.png" alt="" className="w-7 h-7 rounded" />
            <span className="font-semibold text-sm hidden sm:inline">YUGC 论坛</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm ml-2">
            <ForumNav to="/" end>首页</ForumNav>
            <ForumNav to="/categories">分类</ForumNav>
            {u && <ForumNav to="/new">发帖</ForumNav>}
            <a href={externalUrl("portal", "/")}
              className="px-3 py-1.5 rounded text-ink-200 hover:text-brand-500 hover:bg-brand-500/8 transition">← 主站</a>
          </nav>
          <form className="ml-auto hidden md:flex" onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q") as string;
            if (q?.trim()) nav(`/?q=${encodeURIComponent(q.trim())}`);
          }}>
            <input name="q" placeholder="搜帖子标题…" className="input text-sm h-8 w-56" defaultValue={new URLSearchParams(loc.search).get("q") ?? ""} />
          </form>
          <div className="flex items-center gap-2 ml-2">
            <ThemeSwitcher compact />
            {!me.data && <span className="text-ink-400 text-xs">…</span>}
            {me.data && !u && (
              <>
                <Link to="/login" className="btn-ghost text-sm py-1.5 px-3">登录</Link>
                <Link to="/register" className="btn-primary text-sm py-1.5 px-3">注册</Link>
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
                      <MenuLink to={`/u/${u.username}`} onClick={() => setMenuOpen(false)}>我的主页</MenuLink>
                      <MenuLink to="/me" onClick={() => setMenuOpen(false)}>账号设置</MenuLink>
                      <MenuLink to="/me/notifications" onClick={() => setMenuOpen(false)}>通知中心</MenuLink>
                      {(u.role === "admin" || u.role === "mod") && (
                        <MenuLink to="/admin" onClick={() => setMenuOpen(false)}>论坛管理</MenuLink>
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
      {u && !u.has_github && !bannerDismissed && (
        <div className="bg-brand-500/10 border-b border-brand-500/20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3 text-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0 text-brand-500"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.11.78-.25.78-.55v-1.95c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 015.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.79.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
            <div className="flex-1 min-w-0 text-ink-100">
              你还没绑定 GitHub。绑定后可一键登录、与管理后台共用账号，并解锁组织成员权限。
            </div>
            <a href={`/auth/forum/github?bind=1&return_to=${encodeURIComponent(`${window.location.origin}${window.location.pathname}`)}`}
              className="btn-primary text-xs py-1.5 px-3 shrink-0">立即绑定</a>
            <button onClick={() => { try { sessionStorage.setItem("forum-bind-banner-dismissed", "1"); } catch {} setBannerDismissed(true); }}
              className="text-ink-400 hover:text-ink-100 text-lg leading-none shrink-0" aria-label="关闭">×</button>
          </div>
        </div>
      )}
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
