#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))];
const textExtensions = new Set([".md", ".mdc", ".ts", ".tsx", ".js", ".mjs", ".json", ".yaml", ".yml", ".sh", ".conf"]);
const rules = [
  { name: "inline SSH password", pattern: /sshpass\s+-p\s+(?:'[^']+'|"[^"]+")/ },
  { name: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
];
const findings = [];
let checked = 0;
for (const file of files) {
  // Filename inspection is sufficient for forbidden env/DB artifacts; never read them.
  if ((/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example")) || /\.(?:db|db-wal|db-shm)$/.test(file)) {
    findings.push(`${file}: private environment/database artifact must not enter version control`);
    continue;
  }
  if (/(?:^|\/)\.env/.test(file) || !textExtensions.has(extname(file))) continue;
  const path = resolve(root, file);
  if (!existsSync(path)) continue;
  checked++;
  readFileSync(path, "utf8").split("\n").forEach((line, index) => {
    for (const rule of rules) if (rule.pattern.test(line)) findings.push(`${file}:${index + 1}: ${rule.name} [REDACTED]`);
  });
}
if (findings.length) { console.error(findings.join("\n")); process.exitCode = 1; }
else console.log(`Credential-pattern check passed: ${checked} project text files; private env/data and Git history were not read.`);
