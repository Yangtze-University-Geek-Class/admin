#!/usr/bin/env node
/**
 * 预发布到正式的同构清单与烟测（#309）。
 *
 * 预发布上做过的每一件事，正式都要有对应动作。代码靠提交带过去；表结构、数据、env 键与密钥、宿主配置、外部服务
 * 不在提交里，靠这份清单（deploy/parity/ledger.json）记账：预发布做的时候登记，正式做完改成 done，发版前清零。
 *
 *   node scripts/parity.mjs list
 *   node scripts/parity.mjs check [--release --version <版本>|--complete]   校验清单格式；--release 要求部署前的条目（phase 缺省或 pre_deploy）没有 pending，
 *                                                    部署后才能做的条目（phase: post_deploy）只拦不属于这次版本的遗留（release 字段 ≠ --version）；--complete 要求全部清零（部署后收尾核对）
 *   node scripts/parity.mjs add --surface <schema|data|env|host|external> --title <一句话> --issue <编号> \
 *        --preview-evidence <预发布做了什么、怎么验证的> --production-action <正式要做的动作和命令> [--phase pre_deploy|post_deploy --release <版本>]
 *   node scripts/parity.mjs done <P-0001> --evidence <正式做了什么、怎么验证的>
 *   node scripts/parity.mjs not-applicable <P-0001> --reason <为什么正式不需要>
 *   node scripts/parity.mjs waive <P-0001> --by Crosery --quote <所有者的原话>   只记录所有者的豁免，不替所有者决定
 *   node scripts/parity.mjs smoke --origin <站点> --env <production|preview>    deploy/parity/smoke.json 的 require 段
 *   node scripts/parity.mjs compare --preview <站点> --production <站点>        mirror 段：两边状态、类型必须一致；sameShape 再比 JSON 的键和值类型（数据不比，只比格式）
 *
 * 时间取系统时钟（北京时间），不手填；只追加条目，已写的条目只能把 production.status 从 pending 往前推。
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEDGER_FILE = 'deploy/parity/ledger.json';
export const SMOKE_FILE = 'deploy/parity/smoke.json';
export const SURFACES = Object.freeze(['schema', 'data', 'env', 'host', 'external']);
export const STATUSES = Object.freeze(['pending', 'done', 'not_applicable', 'waived']);
// pre_deploy（缺省）：部署之前必须做完；post_deploy：依赖这次部署本身（如要等正式服务起来才能改接），部署后立刻做，--complete 收尾核对
export const PHASES = Object.freeze(['pre_deploy', 'post_deploy']);
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\+08:00)?)?$/;

export function beijingNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
  return `${parts.replace(' ', 'T')}+08:00`;
}

const text = (value, min = 8) => typeof value === 'string' && value.trim().length >= min;

/** 校验清单，返回问题列表（空 = 格式正确）。 */
export function validateLedger(ledger) {
  const problems = [];
  if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries)) return ['清单必须是 { schemaVersion: 1, entries: [] }'];
  const ids = new Set();
  for (const entry of ledger.entries) {
    const at = `${entry?.id ?? '?'}`;
    if (!/^P-\d{4}$/.test(entry?.id ?? '')) problems.push(`${at}：id 必须形如 P-0001`);
    if (ids.has(entry?.id)) problems.push(`${at}：id 重复`);
    ids.add(entry?.id);
    if (!SURFACES.includes(entry?.surface)) problems.push(`${at}：surface 只能是 ${SURFACES.join('、')}`);
    if (!text(entry?.title, 4)) problems.push(`${at}：缺 title`);
    if (entry?.phase !== undefined && !PHASES.includes(entry.phase)) problems.push(`${at}：phase 只能是 ${PHASES.join('、')}`);
    if (entry?.phase === 'post_deploy' && !VERSION_RE.test(entry?.release ?? '')) problems.push(`${at}：post_deploy 要写 release（随哪个版本部署，形如 0.1.1），下一个版本发布前它必须已经收尾`);
    if (!Number.isInteger(entry?.issue) || entry.issue < 1) problems.push(`${at}：issue 必须是正整数`);
    if (!DATE_RE.test(entry?.preview?.doneAt ?? '') || !text(entry?.preview?.evidence)) problems.push(`${at}：preview 要有 doneAt 和 evidence（预发布做了什么、怎么验证）`);
    const production = entry?.production ?? {};
    if (!STATUSES.includes(production.status)) problems.push(`${at}：production.status 只能是 ${STATUSES.join('、')}`);
    if (!text(production.action)) problems.push(`${at}：production.action 要写清正式要做的动作`);
    if (production.status === 'done' && (!DATE_RE.test(production.doneAt ?? '') || !text(production.evidence))) problems.push(`${at}：done 要有 doneAt 和 evidence`);
    if (production.status === 'not_applicable' && !text(production.reason)) problems.push(`${at}：not_applicable 要写理由`);
    if (production.status === 'waived' && !(production.waiver?.by === 'Crosery' && DATE_RE.test(production.waiver?.at ?? '') && text(production.waiver?.quote))) problems.push(`${at}：waived 要有所有者的 by、at 和原话 quote`);
  }
  return problems;
}

/** 发版前的清单核对：仍是 pending 的条目列出来。 */
export function pendingEntries(ledger, { phase } = {}) {
  return ledger.entries.filter(entry => entry.production?.status === 'pending' && (phase === undefined || (entry.phase ?? 'pre_deploy') === phase));
}

/**
 * check 的判定：release 拦部署前的条目，以及属于更早版本的 post_deploy 遗留（本版本的 post_deploy 只列出来，部署后立刻做）；
 * complete 要求全部清零；缺省只校验格式。release 必须给 version，否则遗留无从判断。
 */
export function gateReport(ledger, mode, { version } = {}) {
  if (mode === 'release' && !VERSION_RE.test(version ?? '')) throw new Error('check --release 要带 --version <x.y.z>');
  const postDeploy = mode === 'release' ? pendingEntries(ledger, { phase: 'post_deploy' }) : [];
  const leftover = postDeploy.filter(entry => entry.release !== version);
  const blocking = mode === 'complete' ? pendingEntries(ledger) : mode === 'release' ? [...pendingEntries(ledger, { phase: 'pre_deploy' }), ...leftover] : [];
  const after = postDeploy.filter(entry => entry.release === version);
  return { blocking, after };
}

export function nextId(ledger) {
  const max = ledger.entries.reduce((m, entry) => Math.max(m, Number(/^P-(\d{4})$/.exec(entry.id)?.[1] ?? 0)), 0);
  return `P-${String(max + 1).padStart(4, '0')}`;
}

export function addEntry(ledger, { surface, title, issue, previewEvidence, productionAction, phase, release, now = beijingNow() }) {
  const entry = {
    id: nextId(ledger), surface, title, issue: Number(issue), ...(phase === undefined ? {} : { phase }), ...(release === undefined ? {} : { release }),
    preview: { doneAt: now, evidence: previewEvidence },
    production: { status: 'pending', action: productionAction },
  };
  const next = { ...ledger, entries: [...ledger.entries, entry] };
  const problems = validateLedger(next);
  if (problems.length) throw new Error(problems.join('\n'));
  return { ledger: next, entry };
}

export function updateEntry(ledger, id, change) {
  const entry = ledger.entries.find(item => item.id === id);
  if (!entry) throw new Error(`没有这条同构记录：${id}`);
  if (entry.production.status !== 'pending') throw new Error(`${id} 已经是 ${entry.production.status}，已写的结论不改；写错了追加一条说明的新记录`);
  const next = { ...ledger, entries: ledger.entries.map(item => (item.id === id ? { ...item, production: { ...item.production, ...change } } : item)) };
  const problems = validateLedger(next);
  if (problems.length) throw new Error(problems.join('\n'));
  return next;
}

// ───────────────────────── 烟测 ─────────────────────────

const fill = (value, vars) => String(value).replaceAll('{origin}', vars.origin).replaceAll('{env}', vars.env);

async function fetchOnce(fetchImpl, url) {
  const response = await fetchImpl(url, { redirect: 'manual', headers: { 'user-agent': 'yzgc-parity-smoke' }, signal: AbortSignal.timeout(20000) });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, type: (response.headers.get('content-type') ?? '').split(';')[0].trim(), location: response.headers.get('location') ?? '', body };
}

/** require 段：正式（或任一环境）必须满足的绝对期望。 */
export async function runRequire(manifest, { origin, env }, fetchImpl = globalThis.fetch) {
  const failures = [];
  const base = origin.replace(/\/$/, '');
  for (const item of manifest.require ?? []) {
    let result;
    try {
      result = await fetchOnce(fetchImpl, base + item.path);
    } catch (error) {
      failures.push(`${item.path}：请求失败 ${error.message}`);
      continue;
    }
    const body = result.body.toString('utf8');
    if (result.status !== item.status) failures.push(`${item.path}：状态 ${result.status}，应为 ${item.status}`);
    if (item.contains && !body.includes(fill(item.contains, { origin: base, env }))) failures.push(`${item.path}：正文缺少 ${fill(item.contains, { origin: base, env })}`);
    for (const [key, expected] of Object.entries(item.json ?? {})) {
      let parsed;
      try { parsed = JSON.parse(body); } catch { failures.push(`${item.path}：不是 JSON`); break; }
      if (String(parsed[key]) !== fill(expected, { origin: base, env })) failures.push(`${item.path}：${key} 是 ${JSON.stringify(parsed[key])}，应为 ${fill(expected, { origin: base, env })}`);
    }
    for (const forbidden of item.notContains ?? []) {
      const value = fill(forbidden, { origin: base, env });
      if (body.includes(value)) failures.push(`${item.path}：正文含有不该出现的 ${value}`);
    }
  }
  return failures;
}

/** JSON 值的格式：键与值类型，不含值本身。数据各环境自己的，对齐的只是格式。 */
export function shapeOf(value) {
  if (value === null) return { t: 'null' };
  if (Array.isArray(value)) return { t: 'array', item: value.map(shapeOf).reduce(mergeShape, null) };
  if (typeof value === 'object') return { t: 'object', keys: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item)])) };
  return { t: typeof value };
}

function mergeShape(a, b) {
  if (!a) return b;
  if (!b || b.t === 'null') return a;
  if (a.t === 'null') return b;
  if (a.t !== b.t) return { t: [...new Set([...a.t.split('|'), ...b.t.split('|')])].sort().join('|') };
  if (a.t === 'array') return { t: 'array', item: mergeShape(a.item, b.item) };
  if (a.t === 'object') {
    const keys = { ...a.keys };
    for (const [key, shape] of Object.entries(b.keys)) keys[key] = key in keys ? mergeShape(keys[key], shape) : shape;
    return { t: 'object', keys };
  }
  return a;
}

/**
 * 两份格式的差异。null 与空数组没有信息量，和任何格式相容；数组里的记录是否带某个可选字段取决于数据，
 * 所以记录内部只比同名字段的类型，不比字段有没有；记录之外的对象（响应的骨架）连字段有没有一起比。
 */
export function shapeDiff(a, b, path = '$', inRecord = false) {
  if (!a || !b || a.t === 'null' || b.t === 'null') return [];
  if (a.t !== b.t) return [`${path} 的类型不同（预发布 ${a.t}，正式 ${b.t}）`];
  if (a.t === 'array') return shapeDiff(a.item, b.item, `${path}[]`, true);
  if (a.t !== 'object') return [];
  const out = [];
  for (const key of new Set([...Object.keys(a.keys), ...Object.keys(b.keys)])) {
    if (!(key in b.keys)) { if (!inRecord) out.push(`${path}.${key} 只在预发布有`); }
    else if (!(key in a.keys)) { if (!inRecord) out.push(`${path}.${key} 只在正式有`); }
    else out.push(...shapeDiff(a.keys[key], b.keys[key], `${path}.${key}`, inRecord));
  }
  return out;
}

/** mirror 段：同一份提交在两个环境里，这些地址的状态、类型必须一致；sameShape 的 JSON 再比格式，sameBody 的静态文件比字节。 */
export async function runCompare(manifest, { preview, production }, fetchImpl = globalThis.fetch) {
  const failures = [];
  for (const item of manifest.mirror ?? []) {
    const [a, b] = await Promise.all([preview, production].map(origin => fetchOnce(fetchImpl, origin.replace(/\/$/, '') + item.path).catch(error => ({ error: error.message }))));
    if (a.error || b.error) { failures.push(`${item.path}：请求失败 ${a.error ?? b.error}`); continue; }
    if (a.status !== b.status) failures.push(`${item.path}：预发布 ${a.status}，正式 ${b.status}`);
    else if (a.type !== b.type) failures.push(`${item.path}：内容类型不同（预发布 ${a.type}，正式 ${b.type}）`);
    else if (item.sameBody && createHash('sha256').update(a.body).digest('hex') !== createHash('sha256').update(b.body).digest('hex')) failures.push(`${item.path}：正文不同（预发布 ${a.body.length} 字节，正式 ${b.body.length} 字节）`);
    if (item.sameShape && a.status === 200 && b.status === 200) {
      try {
        failures.push(...shapeDiff(shapeOf(JSON.parse(a.body.toString('utf8'))), shapeOf(JSON.parse(b.body.toString('utf8')))).map(diff => `${item.path}：格式不同，${diff}`));
      } catch { failures.push(`${item.path}：sameShape 要求两边都是 JSON`); }
    }
    for (const [name, origin, res] of [['预发布', preview, a], ['正式', production, b]]) {
      const body = res.body.toString('utf8');
      for (const key of item.issuerOwnOrigin ? ['issuer'] : []) {
        try {
          const issuer = JSON.parse(body)[key];
          if (res.status === 200 && issuer !== `${origin.replace(/\/$/, '')}/oidc`) failures.push(`${item.path}：${name}的 ${key} 是 ${issuer}，应为 ${origin.replace(/\/$/, '')}/oidc`);
        } catch { if (res.status === 200) failures.push(`${item.path}：${name}不是 JSON`); }
      }
    }
  }
  return failures;
}

// ───────────────────────── 命令行 ─────────────────────────

function root() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}
const readJson = relative => JSON.parse(readFileSync(resolve(root(), relative), 'utf8'));
const writeLedger = ledger => writeFileSync(resolve(root(), LEDGER_FILE), `${JSON.stringify(ledger, null, 2)}\n`);

function option(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}
const need = (argv, name) => {
  const value = option(argv, name);
  if (!value) throw new Error(`缺少 --${name}`);
  return value;
};

function printTable(ledger) {
  for (const entry of ledger.entries) {
    console.log(`${entry.id}  ${entry.production.status.padEnd(14)} ${(entry.phase === 'post_deploy' ? 'post' : 'pre').padEnd(5)} ${entry.surface.padEnd(8)} #${entry.issue}  ${entry.title}`);
  }
}

export async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'smoke') {
    const env = need(rest, 'env');
    const failures = await runRequire(readJson(SMOKE_FILE), { origin: need(rest, 'origin'), env });
    if (failures.length) { console.error(`烟测未通过（${failures.length} 项）：\n  ${failures.join('\n  ')}`); return 1; }
    console.log(`烟测通过：${env} 的 require 段全部满足。`);
    return 0;
  }
  if (command === 'compare') {
    const failures = await runCompare(readJson(SMOKE_FILE), { preview: need(rest, 'preview'), production: need(rest, 'production') });
    if (failures.length) { console.error(`同构对比未通过（${failures.length} 项）：\n  ${failures.join('\n  ')}`); return 1; }
    console.log('同构对比通过：mirror 段在预发布与正式一致。');
    return 0;
  }
  const ledger = readJson(LEDGER_FILE);
  const problems = validateLedger(ledger);
  if (problems.length) { console.error(`同构清单格式有误：\n  ${problems.join('\n  ')}`); return 1; }
  if (command === 'list') { printTable(ledger); return 0; }
  if (command === 'check') {
    const pending = pendingEntries(ledger);
    const unknown = rest.filter((arg, index) => !['--complete', '--release', '--version'].includes(arg) && rest[index - 1] !== '--version');
    if (unknown.length) { console.error(`check 不认识 ${unknown.join(' ')}：只有 --release --version <x.y.z>、--complete，或不带参数只校验格式`); return 2; }
    const mode = rest.includes('--complete') ? 'complete' : rest.includes('--release') ? 'release' : undefined;
    let report;
    try { report = gateReport(ledger, mode, { version: option(rest, 'version')?.replace(/^v/, '') }); } catch (error) { console.error(error.message); return 2; }
    const { blocking, after } = report;
    if (blocking.length) {
      console.error(`同构清单还有 ${blocking.length} 条正式没做完，${mode === 'complete' ? '收尾前' : '发版前'}必须清零（做完改 done，确实不需要写 not-applicable，所有者豁免写 waive）：`);
      for (const entry of blocking) console.error(`  ${entry.id} [${entry.surface}] #${entry.issue} ${entry.title}\n      正式要做：${entry.production.action}`);
      return 1;
    }
    if (after.length) {
      console.log(`随这个版本部署后立刻要做的有 ${after.length} 条（下一个版本发布前必须收尾，check --complete 核对）：`);
      for (const entry of after) console.log(`  ${entry.id} [${entry.surface}] #${entry.issue} ${entry.title}`);
    }
    console.log(`同构清单格式正确：共 ${ledger.entries.length} 条，pending ${pending.length} 条。`);
    return 0;
  }
  if (command === 'add') {
    const surface = need(rest, 'surface');
    const { ledger: next, entry } = addEntry(ledger, { surface, title: need(rest, 'title'), issue: need(rest, 'issue'), previewEvidence: need(rest, 'preview-evidence'), productionAction: need(rest, 'production-action'), phase: option(rest, 'phase'), release: option(rest, 'release') });
    writeLedger(next);
    console.log(`已登记 ${entry.id}：${entry.title}（正式待做）`);
    return 0;
  }
  const id = rest[0];
  if (command === 'done') { writeLedger(updateEntry(ledger, id, { status: 'done', doneAt: beijingNow(), evidence: need(rest, 'evidence') })); console.log(`${id} 已标 done`); return 0; }
  if (command === 'not-applicable') { writeLedger(updateEntry(ledger, id, { status: 'not_applicable', reason: need(rest, 'reason') })); console.log(`${id} 已标 not_applicable`); return 0; }
  if (command === 'waive') { writeLedger(updateEntry(ledger, id, { status: 'waived', waiver: { by: need(rest, 'by'), at: beijingNow(), quote: need(rest, 'quote') } })); console.log(`${id} 已记录所有者豁免`); return 0; }
  console.error('用法：node scripts/parity.mjs <list|check [--release --version <x.y.z>|--complete]|add|done|not-applicable|waive|smoke|compare>，详见文件头注释');
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(error.message); process.exit(1); });
}
