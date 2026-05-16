import { NavLink, Outlet, useNavigate, useParams, Link } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import ThemeSwitcher from "../../components/ThemeSwitcher";

const NAV_ALL = [
  { to: "", label: "总览", end: true, icon: "M3 12 12 3l9 9M5 10v10h14V10", admin: false },
  { to: "members", label: "成员", icon: "M16 14a4 4 0 1 0-8 0M3 21v-2a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v2", admin: false },
  { to: "invitations", label: "邀请", icon: "M3 8l9 6 9-6M3 8v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8M3 8l2-3h14l2 3", admin: true },
  { to: "invite-links", label: "邀请链接", icon: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7L11.5 5.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5", admin: true },
  { to: "teams", label: "团队", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", admin: false },
  { to: "repos", label: "仓库", icon: "M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14M4 19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2M4 19h16M9 7h6M9 11h6M9 15h4", admin: false },
  { to: "activity", label: "活动", icon: "M3 12h4l3-9 4 18 3-9h4", admin: false },
  { to: "security", label: "安全", icon: "M12 2 4 5v7c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3Z", admin: false },
  { to: "org", label: "组织资料", icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9h6M9 13h6M9 17h6", admin: false },
  { to: "logs", label: "操作日志", icon: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9 9h6M9 13h6M9 17h4", admin: true },
];

type OverviewResp = { role: "admin" | "member"; org: any; counts: any };
type Me = { signed_in: boolean; login?: string; avatar_url?: string };

export default function OrgLayout() {
  const { org } = useParams();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/auth/me") });
  const orgs = useQuery({
    queryKey: ["my-orgs"],
    queryFn: () => api<{ orgs: any[] }>("/api/me/orgs"),
    enabled: Boolean(me.data?.signed_in),
  });
  const overview = useQuery({
    queryKey: ["overview", org],
    queryFn: () => api<OverviewResp>(`/api/admin/${org}/overview`),
    enabled: Boolean(me.data?.signed_in && org),
  });

  useEffect(() => {
    if (me.isSuccess && !me.data?.signed_in) {
      navigate(`/admin/signin?return_to=/admin/${org}`, { replace: true });
    }
  }, [me.isSuccess, me.data, navigate, org]);

  if (me.isLoading || overview.isLoading) {
    return <div className="min-h-full grid place-items-center text-ink-500">加载中…</div>;
  }
  if (overview.error) {
    const err = overview.error as Error;
    return (
      <div className="min-h-full grid place-items-center px-4">
        <div className="card p-8 max-w-md text-center">
          <h2 className="text-xl text-ink-100 mb-2">无权访问该组织</h2>
          <p className="text-ink-400 text-sm mb-4">{err.message}</p>
          <Link to="/admin" className="btn-ghost">返回组织列表</Link>
        </div>
      </div>
    );
  }
  if (!overview.data) return null;

  const role = overview.data.role;
  const isAdmin = role === "admin";
  const NAV = NAV_ALL.filter((n) => !n.admin || isAdmin);
  const currentOrg = orgs.data?.orgs.find((o: any) => o.login === org);

  const signOut = async () => {
    await fetch("/auth/signout", { method: "POST" });
    navigate("/admin/signin", { replace: true });
  };

  const switchOrg = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === "__list__") navigate("/admin");
    else navigate(`/admin/${v}`);
  };

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex w-64 flex-col border-r border-ink-800/70 bg-ink-950/80 backdrop-blur p-4">
        <Link to="/admin" className="flex items-center gap-3 px-2 py-3 mb-3 hover:bg-ink-800/30 rounded-lg">
          <img src="/logo.png" alt="" className="w-8 h-8 rounded-md border border-ink-700" />
          <div className="min-w-0">
            <div className="font-mono text-[10px] text-ink-500 tracking-wider">YUGC ADMIN</div>
            <div className="text-ink-100 font-semibold text-sm">全部组织</div>
          </div>
        </Link>

        <select value={org} onChange={switchOrg} className="input text-sm mb-4 font-mono">
          {orgs.data?.orgs.map((o: any) => (
            <option key={o.login} value={o.login}>@{o.login} ({o.role})</option>
          ))}
          <option value="__list__">— 切换 / 全部组织 —</option>
        </select>

        <nav className="space-y-1 flex-1 overflow-auto">
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

        <div className="border-t border-ink-800/60 pt-3 mt-3 px-1 text-xs">
          <div className="flex items-center gap-2 mb-2">
            {me.data?.avatar_url && <img src={me.data.avatar_url} alt="" className="w-7 h-7 rounded-full border border-ink-700/60" />}
            <div className="min-w-0">
              <div className="text-ink-200 font-mono truncate">@{me.data?.login}</div>
              <div className="text-ink-500 text-[10px]">{currentOrg ? `${currentOrg.role} of @${org}` : ""}</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <ThemeSwitcher />
            <button onClick={signOut} className="text-rose-400 hover:text-rose-300 text-xs px-2">退出</button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <Outlet context={{ role, org, isAdmin }} />
      </main>
    </div>
  );
}
