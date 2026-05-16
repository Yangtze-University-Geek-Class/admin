import { NavLink, Outlet, useNavigate, useParams, Link } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import ThemeSwitcher from "../../components/ThemeSwitcher";
import Select from "../../components/Select";

type NavItem = { to: string; label: string; end?: boolean; admin: boolean; svg: JSX.Element };

const NAV_ALL: NavItem[] = [
  { to: "", label: "总览", end: true, admin: false, svg: (<><path d="M3 12 12 3l9 9" /><path d="M5 10v10h14V10" /></>) },
  { to: "members", label: "成员", admin: false, svg: (<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>) },
  { to: "invitations", label: "邀请", admin: true, svg: (<><path d="M3 7l9 6 9-6" /><rect x="3" y="5" width="18" height="14" rx="2" /></>) },
  { to: "invite-links", label: "邀请链接", admin: true, svg: (<><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></>) },
  { to: "teams", label: "团队", admin: false, svg: (<><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="9" r="3" /><path d="M2 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" /><path d="M16 14h1a4 4 0 0 1 4 4v2" /></>) },
  { to: "repos", label: "仓库", admin: false, svg: (<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>) },
  { to: "activity", label: "活动", admin: false, svg: (<path d="M3 12h4l3-9 4 18 3-9h4" />) },
  { to: "security", label: "安全", admin: false, svg: (<path d="M12 2 4 5v7c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3Z" />) },
  { to: "org", label: "组织资料", admin: false, svg: (<><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 9h.01M9 13h.01M9 17h.01M14 9h.01M14 13h.01M14 17h.01" /></>) },
  { to: "logs", label: "操作日志", admin: true, svg: (<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>) },
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

  const switchOrg = (v: string) => {
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

        <div className="mb-4">
          <Select
            value={org ?? ""}
            onChange={switchOrg}
            size="sm"
            options={[
              ...(orgs.data?.orgs ?? []).map((o: any) => ({ value: o.login, label: `@${o.login}`, hint: o.role })),
              { value: "__list__", label: "— 切换 / 全部组织 —" },
            ]}
          />
        </div>

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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 flex-shrink-0">
                {n.svg}
              </svg>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-800/60 pt-3 mt-3 px-1 text-xs">
          <div className="flex items-center gap-2 mb-3">
            {me.data?.avatar_url && <img src={me.data.avatar_url} alt="" className="w-8 h-8 rounded-full border border-ink-700/60 flex-shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="text-ink-200 font-mono truncate">@{me.data?.login}</div>
              <div className="text-ink-500 text-[10px] truncate">{currentOrg ? `${currentOrg.role} of @${org}` : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSwitcher compact direction="up" />
            <button onClick={signOut}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-ink-700/60 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40 transition text-xs">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              退出
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <Outlet context={{ role, org, isAdmin }} />
      </main>
    </div>
  );
}
