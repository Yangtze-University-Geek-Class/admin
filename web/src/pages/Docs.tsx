import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { api } from "../lib/api";
import ThemeSwitcher from "../components/ThemeSwitcher";

type Item = { id: string; label: string; lang: "zh" | "en" };
type Doc = { id: string; label: string; lang: "zh" | "en"; file: string; content: string };

marked.setOptions({ gfm: true, breaks: false });

export default function Docs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lang, setLang] = useState<"zh" | "en">("zh");

  const list = useQuery({ queryKey: ["docs"], queryFn: () => api<{ items: Item[] }>("/api/docs") });
  const current = useQuery({
    queryKey: ["doc", id],
    queryFn: () => api<Doc>(`/api/docs/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!id && list.data?.items.length) {
      const def = list.data.items.find((i) => i.lang === lang) ?? list.data.items[0];
      navigate(`/docs/${def.id}`, { replace: true });
    }
  }, [id, list.data, lang, navigate]);

  const items = list.data?.items ?? [];
  const filtered = items.filter((i) => i.lang === lang);

  const html = useMemo(() => {
    if (!current.data?.content) return "";
    return marked.parse(current.data.content) as string;
  }, [current.data?.content]);

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="w-9 h-9 rounded-lg border border-ink-700" />
          <span className="font-semibold text-ink-100 text-lg">YUGC Admin · 文档</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex border border-ink-700/60 rounded-lg overflow-hidden text-sm">
            {(["zh", "en"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-3 py-1.5 transition ${
                  lang === l ? "bg-brand-500/20 text-brand-500" : "text-ink-300 hover:bg-ink-800/60"
                }`}>{l === "zh" ? "中文" : "English"}</button>
            ))}
          </div>
          <ThemeSwitcher />
          <Link to="/admin" className="btn-ghost text-sm">管理后台</Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-[220px_minmax(0,1fr)] gap-8">
        <aside className="md:sticky md:top-4 self-start">
          <nav className="space-y-1">
            {filtered.map((it) => (
              <Link key={it.id} to={`/docs/${it.id}`}
                className={`block px-3 py-2 rounded-lg text-sm transition ${
                  it.id === id ? "bg-brand-500/15 text-brand-500 border border-brand-500/30" : "text-ink-300 hover:bg-ink-800/60 border border-transparent"
                }`}>{it.label}</Link>
            ))}
            {filtered.length === 0 && <p className="text-xs text-ink-500 px-3">无</p>}
          </nav>
        </aside>

        <main className="min-w-0 pb-16">
          {current.isLoading && <div className="text-ink-500">加载中…</div>}
          {current.error && <div className="text-rose-400">{(current.error as Error).message}</div>}
          {current.data && (
            <article className="prose-doc" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </main>
      </div>
    </div>
  );
}
