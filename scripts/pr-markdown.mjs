// PR 必填内容只接受正文段落；代码示例和隐藏注释不能提供门禁证据。
export function visibleProse(body) {
  const lines = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
  let fence = null;
  let comment = false;
  return lines.map(line => {
    if (fence) {
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
      return "";
    }
    if (!comment && /^(?: {4}|\t)/.test(line)) return "";
    const opening = !comment && /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && (opening[1][0] !== "`" || !opening[2].includes("`"))) {
      fence = opening[1];
      return "";
    }
    let visible = "", cursor = 0;
    while (cursor < line.length) {
      if (comment) {
        const end = line.indexOf("-->", cursor);
        if (end < 0) break;
        comment = false; cursor = end + 3;
      } else {
        const start = line.indexOf("<!--", cursor);
        if (start < 0) { visible += line.slice(cursor); break; }
        visible += line.slice(cursor, start); comment = true; cursor = start + 4;
      }
    }
    return visible;
  }).join("\n");
}

export function parsePrSections(body) {
  const parts = new Map();
  const duplicates = new Set();
  let current = null;
  for (const line of visibleProse(body).split("\n")) {
    const heading = /^ {0,3}###[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading) {
      current = heading[1].replace(/[ \t]+#+[ \t]*$/, "").replace(/[（(].*$/, "").trim();
      if (parts.has(current)) duplicates.add(current);
      else parts.set(current, "");
    } else if (current !== null) parts.set(current, `${parts.get(current)}${line}\n`);
  }
  return { parts, duplicates };
}
