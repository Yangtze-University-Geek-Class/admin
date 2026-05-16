import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

function rewriteResources(html: string): string {
  return html.replace(/(src|href)=("|')(bbs\/[^"']+)\2/g, '$1=$2/forum/r/$3$2');
}

export function renderPostContent(content: string, _format: "markdown" | "html" | string): string {
  if (!content) return "";
  const html = marked.parse(content) as string;
  const rewritten = rewriteResources(html);
  return String(DOMPurify.sanitize(rewritten, { ADD_ATTR: ["target", "loading"] }));
}
