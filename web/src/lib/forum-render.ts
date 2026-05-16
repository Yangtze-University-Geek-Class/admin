import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

function rewriteResources(html: string): string {
  return html.replace(/(src|href)=("|')(bbs\/[^"']+)\2/g, '$1=$2/forum/r/$3$2');
}

export function renderPostContent(content: string, format: "markdown" | "html" | string): string {
  if (!content) return "";
  let raw: string;
  if (format === "html") {
    raw = rewriteResources(content);
  } else {
    raw = marked.parse(content) as string;
    raw = rewriteResources(raw);
  }
  return String(DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "loading"] }));
}
