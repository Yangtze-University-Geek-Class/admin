import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

const NAV = [
  { to: "/admin", label: "总览", end: true, icon: "M3 12 12 3l9 9M5 10v10h14V10" },
  { to: "/admin/members", label: "成员", icon: "M16 14a4 4 0 1 0-8 0M3 21v-2a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v2" },
  { to: "/admin/invitations", label: "邀请", icon: "M3 8l9 6 9-6M3 8v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8M3 8l2-3h14l2 3" },
  { to: "/admin/teams", label: "团队", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" },
  { to: "/admin/repos", label: "仓库", icon: "M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14M4 19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2M4 19h16M9 7h6M9 11h6M9 15h4" },
  { to: "/admin/activity", label: "活动", icon: "M3 12h4l3-9 4 18 3-9h4" },
  { to: "/admin/security", label: "安全", icon: "M12 2 4 5v7c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3Z" },
  { to: "/admin/org", label: "组织资料", icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9h6M9 13h6M9 17h6" },
  { to: "/admin/logs", label: "操作日志", icon: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9 9h6M9 13h6M9 17h4" },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const { data: me, isLoading, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ signed_in: boolean; is_admin?: boolean; login?: string }>("/auth/me"),
    retry: false,
  });

  useEffect(() => {
    if (!isLoading && (isError || !me?.signed_in || !me?.is_admin)) {
      navigate("/admin/signin", { replace: true });
    }
  }, [isLoading, isError, me, navigate]);

  if (isLoading || !me?.is_admin) {
    return <div className="min-h-full grid place-items-center text-ink-500">加载中…</div>;
  }

  const signOut = async () => {
    await fetch("/auth/signout", { method: "POST" });
    navigate("/admin/signin", { replace: true });
  };

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex w-64 flex-col border-r border-ink-800/70 bg-ink-950/80 backdrop-blur p-4">
        <div className="px-2 py-3 mb-4">
          <div className="font-mono text-xs text-ink-500 tracking-wider">YZGC ADMIN</div>
          <div className="text-ink-100 font-semibold text-lg mt-1">Geek Class</div>
        </div>
        <nav className="space-y-1 flex-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                  isActive ? "bg-brand-500/15 text-brand-500 border border-brand-500/30" : "text-ink-300 hover:bg-ink-800/50 border border-transparent"
                }`
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d={n.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-ink-800/60 pt-3 mt-3 px-2 text-xs text-ink-500">
          <div>登录为</div>
          <div className="text-ink-200 mt-0.5 font-mono">@{me.login}</div>
          <button onClick={signOut} className="mt-3 text-rose-400 hover:text-rose-300">退出</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
