#!/usr/bin/env node
// 从现有 nginx 的权威 CSP 和两份环境模板生成 Arch 边缘配置，不维护第三份策略常量。
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_ORIGINS, parseEnvFileText } from './deployment-environment.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const usage = '用法：node scripts/render-arch-caddy.mjs --out <空输出目录> [--include-legacy-admin]\n默认仅生成主域和预发布入口。--include-legacy-admin 仅可在旧管理域名迁移另获独立授权后使用。';
if (args.length === 1 && args[0] === '--help') {
  console.log(usage);
  process.exit(0);
}
let output;
let includeLegacyAdmin = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--out' && output === undefined && args[index + 1] && !args[index + 1].startsWith('--')) output = args[++index];
  else if (args[index] === '--include-legacy-admin' && !includeLegacyAdmin) includeLegacyAdmin = true;
  else throw new Error(usage);
}
if (!output) throw new Error(usage);
const out = resolve(output);
let ancestor = out;
while (!existsSync(ancestor)) ancestor = dirname(ancestor);
const destination = resolve(realpathSync(ancestor), relative(ancestor, out));
if (/(?:^|\/)caddy\/sites(?:\/|$)/i.test(destination)) throw new Error('拒绝写入 Caddy sites 自动激活目录；请生成到独立待审目录');
mkdirSync(out, { recursive: true, mode: 0o700 });
if (readdirSync(out).length) throw new Error('输出目录非空，拒绝覆盖');
let legacyAdmin;
const policies = ['production', 'preview'].map(environment => {
  const text = readFileSync(resolve(root, 'deploy/nginx', `${environment}.conf`), 'utf8');
  const defaults = [...text.matchAll(/^\s*default\s+"([^"]+)";\s*$/gm)];
  const limits = [...text.matchAll(/^\s*client_max_body_size\s+(\d+)([kKmMgG]?);\s*$/gm)];
  if (defaults.length !== 1 || limits.length !== 1) throw new Error(`${environment} nginx 模板没有唯一的默认 CSP/请求体上限`);
  const multiplier = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[limits[0][2].toLowerCase()];
  const redirects = [...text.matchAll(/^\s*location ~ ([^{\n]+) \{\n\s*return (301) ([^;\n]+);/gm)]
    .map(([, pattern, status, target]) => ({ pattern: pattern.trim().replaceAll('\\d', '[0-9]'), status, target: target.trim() }));
  if (redirects.length !== 2) throw new Error(`${environment} nginx 模板缺少历史话题重定向`);
  const headers = new Map();
  for (const [, name, raw] of text.matchAll(/^\s*add_header\s+([A-Za-z0-9-]+)\s+("[^"]*"|[^\s;]+)\s+always;\s*$/gm)) {
    if (name === 'Content-Security-Policy') continue;
    const value = raw.replace(/^"(.*)"$/, '$1');
    if (headers.has(name) && headers.get(name) !== value) throw new Error(`${environment} nginx 安全头有冲突`);
    headers.set(name, value);
  }
  const gzipLevel = text.match(/^\s*gzip_comp_level\s+(\d+);\s*$/m)?.[1];
  const gzipMinimum = text.match(/^\s*gzip_min_length\s+(\d+);\s*$/m)?.[1];
  const gzipTypes = text.match(/^\s*gzip_types\s+([^;]+);\s*$/m)?.[1];
  const readTimeout = text.match(/^\s*proxy_read_timeout\s+(\d+[smh]);\s*$/m)?.[1];
  const upgrade = text.match(/return (301) https:\/\/\$host\$request_uri;/)?.[1];
  if (!headers.size || !gzipLevel || !gzipMinimum || !gzipTypes || !readTimeout || !upgrade || !/^\s*gzip on;\s*$/m.test(text)) {
    throw new Error(`${environment} nginx 网关合同不完整，拒绝生成不同策略`);
  }
  if (environment === 'production' && includeLegacyAdmin) {
    const legacy = text.match(/server_name (github\.[A-Za-z0-9.-]+);[\s\S]*?return (301) (https:\/\/[^;\n]+\$request_uri);/);
    if (!legacy) throw new Error('正式 nginx 模板缺少旧管理域名重定向');
    legacyAdmin = { host: legacy[1], status: legacy[2], target: legacy[3].replace('$request_uri', '{uri}') };
  }
  return {
    csp: defaults[0][1], maxBody: Number(limits[0][1]) * multiplier, redirects,
    headers: [...headers], gzipLevel, gzipMinimum, gzipTypes: ['text/html', ...gzipTypes.trim().split(/\s+/)], readTimeout, upgrade,
  };
});
if (JSON.stringify(policies[0]) !== JSON.stringify(policies[1])) throw new Error('两环境 nginx 网关策略不一致，拒绝生成');
const { csp, maxBody, redirects, headers, gzipLevel, gzipMinimum, gzipTypes, readTimeout, upgrade } = policies[0];
/**
 * 比赛官网资源的对象前缀，与 app/server 的 publicPrefix() 同样拼法：OBJECT_STORAGE_PUBLIC_BASE + OBJECT_STORAGE_PREFIX + contest-sites/。
 * 宿主只放行这一段（不是整个 CDN 域名）；未设 OBJECT_STORAGE_PUBLIC_BASE 时返回 null，策略与原来一字不差。
 */
function contestSitePrefix(values) {
  const publicBase = values.get('OBJECT_STORAGE_PUBLIC_BASE') ?? '';
  if (!publicBase) return null;
  const prefix = values.get('OBJECT_STORAGE_PREFIX') ?? '';
  if (!/^https:\/\/[^/\s]+\/$/.test(publicBase) || !/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\/$/.test(prefix)) {
    throw new Error('OBJECT_STORAGE_PUBLIC_BASE 或 OBJECT_STORAGE_PREFIX 格式不对，拒绝生成比赛官网的 CSP');
  }
  return `${publicBase}${prefix}contest-sites/`;
}
/** 比赛官网页面的资源从这段前缀加载（302 到对象存储），宿主的 script-src、style-src、font-src 都要放行它。 */
function withContestSites(policy, prefix) {
  if (!prefix) return policy;
  const directives = policy.split(';').map(part => part.trim());
  for (const name of ['script-src', 'style-src', 'font-src']) {
    const index = directives.findIndex(part => part.startsWith(`${name} `));
    if (index < 0) throw new Error(`宿主 CSP 缺少 ${name}，拒绝生成比赛官网的放行策略`);
    directives[index] = `${directives[index]} ${prefix}`;
  }
  return directives.join('; ');
}
const securitySnippet = (name, policy) => `(${name}) {
	request_body {
		max_size ${maxBody}
	}
	header {
${headers.map(([name, value]) => `\t\t${name} ${JSON.stringify(value)}`).join('\n')}
	}
	encode {
		gzip ${gzipLevel}
		minimum_length ${gzipMinimum}
		match {
${gzipTypes.map(type => `\t\t\theader Content-Type ${type}*`).join('\n')}
		}
	}
	@forum path /forum/*
	header @forum ?Content-Security-Policy "${policy}"
	@outside_forum not path /forum/*
	header @outside_forum {
		+Content-Security-Policy "${policy}"
		defer
	}
${redirects.map(({ pattern, status, target }, index) => {
  const name = `yzgc_legacy_topic_${index}`;
  const location = target.replaceAll('$host', '{args[0]}').replace(/\$(\d+)/g, `{re.${name}.$1}`);
  return `\t@${name} path_regexp ${name} ${JSON.stringify(pattern)}\n\tredir @${name} ${location} ${status}`;
}).join('\n')}
}
`;
const files = new Map();
const snippets = new Map();
const preflight = [];
for (const [environment, port] of [['production', 18480], ['preview', 18481]]) {
  const text = readFileSync(resolve(root, 'deploy/env', `.env.${environment}`), 'utf8');
  let values;
  try { values = parseEnvFileText(text); } catch { throw new Error(`${environment} 环境模板非法或包含重复键`); }
  const bind = values.get('WEB_BIND');
  const origin = values.get('PUBLIC_ORIGIN');
  const expectedPort = environment === 'production' ? 18100 : 18200;
  if (bind !== `10.66.0.2:${expectedPort}` || origin !== EXPECTED_ORIGINS[environment]) {
    throw new Error(`${environment} 不是已确认的 Arch 私有入口`);
  }
  const host = new URL(origin).hostname;
  snippets.set(environment, securitySnippet(`yzgc-security-${environment}`, withContestSites(csp, contestSitePrefix(values))));
  const handler = `	import yzgc-security-${environment} ${host}
	reverse_proxy ${bind} {
		header_up Host ${host}
		header_up X-Forwarded-For {http.request.remote.host}
		header_up X-Real-IP {http.request.remote.host}
		header_up X-Forwarded-Proto https
		transport http {
			versions 1.1
			read_timeout ${readTimeout}
			response_header_timeout ${readTimeout}
		}
	}
`;
  const upgradeHosts = [host, ...(environment === 'production' && includeLegacyAdmin ? [legacyAdmin.host] : [])];
  const publicSites = `${host} {
${handler}}
${upgradeHosts.map(name => `http://${name} {\n\tredir https://${name}{uri} ${upgrade}\n}\n`).join('\n')}`;
  files.set(`${environment}.caddy`, publicSites + (environment === 'production' && includeLegacyAdmin ? `${legacyAdmin.host} {
	header Strict-Transport-Security ${JSON.stringify(headers.find(([name]) => name === 'Strict-Transport-Security')[1])}
	redir ${legacyAdmin.target} ${legacyAdmin.status}
}
` : ''));
  preflight.push(`http://127.0.0.1:${port} {
	bind 127.0.0.1
	# 只在回环烟测入口不带 Referer，沿用本机 CDN 预览政策；公网站点仍严格同源。
	header >Referrer-Policy no-referrer
${handler}}
`);
}
files.set('common.caddy', [...snippets.values()].join('\n'));
files.set('preflight.caddy', preflight.join('\n'));
for (const [name, text] of files) writeFileSync(resolve(out, name), text, { flag: 'wx', mode: 0o600 });
console.log(`已生成 ${out}：common / preflight / production / preview；preflight 仅香港回环，正式站点须在最终迁移门禁后启用。旧管理域名${includeLegacyAdmin ? '已按显式参数包含' : '未包含'}；--include-legacy-admin 需要旧管理域名迁移的独立授权。`);
