import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
// Load only the languages we actually need to keep bundle small.
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import java from "highlight.js/lib/languages/java";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import shell from "highlight.js/lib/languages/shell";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("java", java);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);

const renderer = new marked.Renderer();
const origCode = renderer.code.bind(renderer);
renderer.code = function (codeOrToken: any, language?: string, isEscaped?: boolean): string {
  // marked v15 passes a token object; older signatures pass (code, lang, escaped)
  const codeStr = typeof codeOrToken === "string" ? codeOrToken : (codeOrToken?.text ?? "");
  const lang = typeof codeOrToken === "string" ? language : (codeOrToken?.lang ?? "");
  const cleanLang = String(lang || "").toLowerCase().trim().split(/\s+/)[0];
  let highlighted = "";
  let detected = cleanLang || "plain";
  try {
    if (cleanLang && hljs.getLanguage(cleanLang)) {
      highlighted = hljs.highlight(codeStr, { language: cleanLang, ignoreIllegals: true }).value;
    } else {
      const auto = hljs.highlightAuto(codeStr);
      highlighted = auto.value;
      detected = auto.language || "plain";
    }
  } catch {
    highlighted = (typeof codeOrToken === "object" && codeOrToken?.text)
      ? escapeHtml(codeStr)
      : (isEscaped ? codeStr : escapeHtml(codeStr));
  }
  return `<div class="code-block" data-lang="${escapeAttr(detected)}"><div class="code-block-bar"><span class="code-block-lang">${escapeAttr(detected)}</span><button type="button" class="code-block-copy" aria-label="复制代码">复制</button></div><pre><code class="hljs language-${escapeAttr(detected)}">${highlighted}</code></pre></div>`;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

marked.use({ renderer, gfm: true, breaks: true });

function rewriteResources(html: string): string {
  return html.replace(/(src|href)=("|')(bbs\/[^"']+)\2/g, '$1=$2/forum/r/$3$2');
}

export function renderPostContent(content: string, _format: "markdown" | "html" | string): string {
  if (!content) return "";
  const html = marked.parse(content) as string;
  const rewritten = rewriteResources(html);
  return String(DOMPurify.sanitize(rewritten, {
    ADD_ATTR: ["target", "loading", "data-lang"],
    ADD_TAGS: ["button"],
  }));
}
