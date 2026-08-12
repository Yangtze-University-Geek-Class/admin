import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { api } from "../../lib/api";
import { getDataSource } from "../../lib/runtime";
import { appConfig } from "../../config";
import ThemeSwitcher from "../../components/ThemeSwitcher";

type Me = { signed_in: boolean; login?: string; avatar_url?: string };
type OrgRow = { login: string; name: string; avatar_url: string; role: "admin" | "member"; html_url: string };

export default function MyOrgs() {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/auth/me") });
  const orgs = useQuery({
    queryKey: ["my-orgs"],
    queryFn: () => api<{ orgs: OrgRow[] }>("/api/me/orgs"),
    enabled: Boolean(me.data?.signed_in),
  });

  useEffect(() => {
    if (me.isSuccess && !me.data?.signed_in) {
      navigate("/admin/signin?return_to=/admin", { replace: true });
    }
  }, [me.isSuccess, me.data, navigate]);

  const signOut = async () => {
    if (getDataSource() === "mock") {
      navigate("/admin/signin", { replace: true });
      return;
    }
    await fetch("/auth/signout", { method: "POST" });
    navigate("/admin/signin", { replace: true });
  };

  if (me.isLoading) return <div className="min-h-full grid place-items-center text-ink-500">加载中…</div>;
  if (!me.data?.signed_in) return null;

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="w-9 h-9 rounded-lg border border-ink-700" />
          <span className="font-semibold text-ink-100 text-lg">YUGC Admin</span>
        </Link>
        <div className="flex items-center gap-3">
          <a href={appConfig.urls.portal} className="px-3 py-1.5 text-sm text-ink-200 hover:text-brand-500 transition">← 主站</a>
          <a href={appConfig.urls.forum} className="px-3 py-1.5 text-sm text-ink-200 hover:text-brand-500 transition">论坛</a>
          <ThemeSwitcher />
          {me.data.avatar_url && <img src={me.data.avatar_url} alt="" className="w-8 h-8 rounded-full border border-ink-700/60" />}
          <span className="text-sm text-ink-200 font-mono">@{me.data.login}</span>
          <button onClick={signOut} className="text-sm text-rose-400 hover:text-rose-300 ml-2">退出</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold text-ink-50 mb-2">你的组织</h1>
        <p className="text-ink-400 mb-8">点击进入对应组织的管理面板。功能按你在该组织内的角色决定。</p>

        {orgs.isLoading && <div className="text-ink-500">加载中…</div>}
        {orgs.error && <div className="text-rose-400">{(orgs.error as Error).message}</div>}
        {orgs.data && orgs.data.orgs.length === 0 && (
          <div className="card p-10 text-center">
            <p className="text-ink-300">你还没有加入任何组织</p>
            <a href="https://github.com/account/organizations/new" target="_blank" rel="noreferrer" className="btn-ghost mt-5 text-sm">
              在 GitHub 上新建组织
            </a>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orgs.data?.orgs.map((o) => (
            <Link key={o.login} to={`/admin/${o.login}`} className="card p-5 flex items-center gap-4 hover:border-brand-500/50 transition group">
              <img src={o.avatar_url} alt="" className="w-14 h-14 rounded-xl border border-ink-700/60" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink-100 truncate group-hover:text-brand-500">{o.name}</div>
                <div className="text-xs text-ink-500 font-mono">@{o.login}</div>
              </div>
              <span className={o.role === "admin" ? "tag-blue" : "tag-gray"}>{o.role}</span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
