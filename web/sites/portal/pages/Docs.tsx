import { useEffect, useMemo, useRef } from "react";
import { externalUrl } from "@shared/lib/site";
import { useProseInteractions } from "@shared/ui/ImageLightbox";
import { getBasePath } from "@shared/lib/runtime";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/lib/api";
import { renderMarkdown } from "@shared/lib/markdown";

type Item = { id: string; label: string; lang: "zh" | "en"; file?: string };
type Doc = { id: string; label: string; lang: "zh" | "en"; file: string; content: string };

export default function Docs() {
  const { id } = useParams();
  const navigate = useNavigate();
  const items = useQuery({ queryKey: ["docs"], queryFn: () => api<{ items: Item[] }>("/api/docs") }).data?.items ?? [];

  // Language is derived from the current doc's id — not a separate state. This
  // way the language toggle and the article are always in sync.
  const currentItem = items.find((i) => i.id === id);
  const lang: "zh" | "en" = currentItem?.lang ?? "zh";

  const current = useQuery({
    queryKey: ["doc", id],
    queryFn: () => api<Doc>(`/api/docs/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!id && items.length) {
      const def = items.find((i) => i.lang === "zh") ?? items[0];
      navigate(`/docs/${def.id}`, { replace: true });
    }
  }, [id, items, navigate]);

  const switchLang = (target: "zh" | "en") => {
    if (target === lang) return;
    if (!id) return;
    // Map current doc to its sibling in the target language.
    // Convention: zh ids have no suffix; en ids end in "-en". Map both ways.
    const base = id.endsWith("-en") ? id.slice(0, -3) : id;
    const targetId = target === "en" ? `${base}-en` : base;
    const found = items.find((i) => i.id === targetId);
    if (found) {
      navigate(`/docs/${found.id}`);
    } else {
      // Fallback: jump to the first doc of the target language.
      const first = items.find((i) => i.lang === target);
      if (first) navigate(`/docs/${first.id}`);
    }
  };

  const filtered = items.filter((i) => i.lang === lang);

  const html = useMemo(() => {
    if (!current.data?.content) return "";
    return renderMarkdown(current.data.content, {
      resolveAsset: path => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path) || !current.data?.file) return null;
        const target = new URL(path, `https://docs.invalid/${current.data.file}`);
        const linked = items.find(item => item.file === target.pathname.slice(1));
        return linked ? `${getBasePath("portal")}/docs/${linked.id}${target.hash}` : null;
      },
    });
  }, [current.data?.content, current.data?.file, items]);

  const articleRef = useRef<HTMLElement>(null);
  useProseInteractions(articleRef, [html]);

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
              <button key={l} onClick={() => switchLang(l)}
                className={`px-3 py-1.5 transition ${
                  lang === l ? "bg-brand-500/20 text-brand-500" : "text-ink-300 hover:bg-ink-800/60"
                }`}>{l === "zh" ? "中文" : "English"}</button>
            ))}
          </div>
          <a href={externalUrl("admin", "/admin")} className="btn-ghost text-sm">管理后台</a>
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
            <article ref={articleRef} className="prose-doc" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </main>
      </div>
    </div>
  );
}
