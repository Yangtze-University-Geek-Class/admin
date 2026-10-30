#!/usr/bin/env node
// 比赛计分规则的模拟（#278，所有者 2026-10-24 16:59 要求用多组数据模拟评分规则）。
//
// 用固定种子的随机数生成几千场比赛，每场 60 人（约四成大一、三成大二、两成大三、一成大四），按候选的年级系数和
// 防刷规则算天梯，统计前 8 名（有奖的名次）里各年级占多少、大一进前 1 / 3 / 8 的概率、大一要做多少才能超过
// 一个普通大三、刷「一般 × 边缘」的人能不能拿奖。基础分表和防刷规则直接读 app/server/src/lib/competition-rubric.ts，
// 和服务端算分是同一份。
//
//   node scripts/contest-score-sim.mjs                 # 默认 5000 场、种子 278，打印 Markdown 表
//   node scripts/contest-score-sim.mjs --contests 20000 --seed 7
//
// 模型里的数（人数比例、每人产出、各年级的重要 / 核心比例、被标「有用」的比例）是按极客班的情况估的，写在 MODELS 里（两套假设）；
// tests/tooling/contest-score-sim.test.ts 用小一点的场数钉住主要结果，改模型或改规则时那边跟着变。
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DAMPING, DEFAULT_GRADE_FACTORS, RUBRIC, isTrivial } from "../app/server/src/lib/competition-rubric.ts";

const GRADES = ["year1", "year2", "year3", "year4"];
const LABELS = { year1: "大一", year2: "大二", year3: "大三", year4: "大四" };

const COMMON = {
  /** 每场的人数与年级构成。 */
  population: { year1: 24, year2: 18, year3: 12, year4: 6 },
  weeks: 4,
  /** 报了名但一条有用贡献也没有的比例。 */
  idleShare: 0.15,
  /** 个人活跃度 = exp(N(0, sigma))：少数人特别活跃。 */
  activitySigma: 0.8,
  /** 提交里 MR 的比例，其余是 Issue。 */
  prShare: { year1: 0.35, year2: 0.5, year3: 0.6, year4: 0.65 },
  /** 重要程度：一般 / 重要 / 关键 的比例。 */
  importance: { year1: [0.7, 0.25, 0.05], year2: [0.55, 0.35, 0.1], year3: [0.4, 0.42, 0.18], year4: [0.35, 0.43, 0.22] },
  /** 核心度：边缘 / 业务 / 核心 的比例。 */
  core: { year1: [0.6, 0.35, 0.05], year2: [0.45, 0.45, 0.1], year3: [0.3, 0.5, 0.2], year4: [0.25, 0.5, 0.25] },
  /** 组织者标记「有用」的比例（没被标的不算分）。 */
  useful: { year1: 0.65, year2: 0.72, year3: 0.8, year4: 0.85 },
  /** 每场有几个人专刷小改动：每周提这么多条，被标有用的一律是「一般 × 边缘」。 */
  spammers: 3,
  spamPerWeek: 8,
  spamUseful: 0.6,
  prizeSlots: 8,
};
/** 两套假设只差每人整场提交的条数均值（再乘个人活跃度）：高年级多一半，或者多一倍多。 */
export const MODELS = {
  base: { ...COMMON, name: "高年级多做一半", itemsPerPerson: { year1: 4, year2: 5, year3: 6, year4: 7 } },
  steep: { ...COMMON, name: "高年级多做一倍多", itemsPerPerson: { year1: 3, year2: 5, year3: 7, year4: 8 } },
};

export const FACTOR_SETS = {
  "1.5 / 1.3 / 1.1 / 1.0（原默认）": { year1: 150, year2: 130, year3: 110, year4: 100 },
  "2.5 / 1.8 / 1.3 / 1.0": { year1: 250, year2: 180, year3: 130, year4: 100 },
  "3.0 / 2.0 / 1.4 / 1.0": { year1: 300, year2: 200, year3: 140, year4: 100 },
  "3.5 / 2.2 / 1.4 / 1.0": { year1: 350, year2: 220, year3: 140, year4: 100 },
  "4.0 / 2.5 / 1.5 / 1.0": { year1: 400, year2: 250, year3: 150, year4: 100 },
  "5.0 / 3.0 / 1.6 / 1.0": { year1: 500, year2: 300, year3: 160, year4: 100 },
};
/** 防刷规则：每人每周「一般 × 边缘」前 fullPerWeek 条照算，之后按 percent%；null 是不打折。 */
export const DAMPING_RULES = {
  "不打折": null,
  "每周前 3 条照算，之后一半": { fullPerWeek: 3, percent: 50 },
  "每周前 2 条照算，之后一半": { fullPerWeek: 2, percent: 50 },
  "每周前 2 条照算，之后不算": { fullPerWeek: 2, percent: 0 },
  "每周只算 1 条（采用）": { fullPerWeek: DAMPING.fullPerWeek, percent: DAMPING.percent },
};
/** 采用的默认系数（和 competition-rubric.ts 的 DEFAULT_GRADE_FACTORS 是同一组）。 */
export const CHOSEN = {
  year1: DEFAULT_GRADE_FACTORS.year1, year2: DEFAULT_GRADE_FACTORS.year2, year3: DEFAULT_GRADE_FACTORS.year3, year4: DEFAULT_GRADE_FACTORS.year4,
};

/** mulberry32：同一个种子每次出同样的序列。 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = random => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
function poisson(random, lambda) {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = random();
  while (p > limit) { k++; p *= random(); }
  return k;
}
function pick(random, weights) {
  let x = random();
  for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
  return weights.length - 1;
}
const IMPORTANCE = ["normal", "important", "critical"];
const CORE = ["edge", "business", "core"];

/** 一场比赛的参赛者和他们被标「有用」的贡献（与系数无关，同一场比赛对每组系数复用）。 */
function contest(random, model) {
  const people = [];
  for (const grade of GRADES) for (let i = 0; i < model.population[grade]; i++) people.push({ grade, items: [], spammer: false });
  // 随机挑几个人当刷分的
  const order = people.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const index of order.slice(0, model.spammers)) people[index].spammer = true;
  for (const person of people) {
    const { grade } = person;
    if (person.spammer) {
      for (let week = 0; week < model.weeks; week++) {
        const count = poisson(random, model.spamPerWeek);
        for (let i = 0; i < count; i++) {
          if (random() >= model.spamUseful) continue;
          person.items.push({ kind: random() < 0.5 ? "pr" : "issue", importance: "normal", core: "edge", week });
        }
      }
      continue;
    }
    if (random() < model.idleShare) continue;
    const activity = Math.exp(normal(random) * model.activitySigma);
    const count = poisson(random, model.itemsPerPerson[grade] * activity);
    for (let i = 0; i < count; i++) {
      if (random() >= model.useful[grade]) continue;
      person.items.push({
        kind: random() < model.prShare[grade] ? "pr" : "issue",
        importance: IMPORTANCE[pick(random, model.importance[grade])],
        core: CORE[pick(random, model.core[grade])],
        week: Math.floor(random() * model.weeks),
      });
    }
  }
  return people;
}

/** 一个人的总分：基础分查表、乘年级系数；有防刷规则时每周超出的「一般 × 边缘」打折。返回 [总分, 被打掉的基础分]。 */
function totalOf(person, factors, rule) {
  const perWeek = new Map();
  let total = 0;
  let cut = 0;
  for (const item of person.items) {
    const base = RUBRIC[item.kind][item.importance][item.core];
    let percent = 100;
    if (rule && isTrivial(item.importance, item.core)) {
      const seen = (perWeek.get(item.week) ?? 0) + 1;
      perWeek.set(item.week, seen);
      if (seen > rule.fullPerWeek) percent = rule.percent;
    }
    cut += base * (100 - percent) / 100;
    total += Math.round(base * factors[person.grade] * percent / 10_000);
  }
  return [total, cut];
}
const baseTotal = person => person.items.reduce((sum, item) => sum + RUBRIC[item.kind][item.importance][item.core], 0);
const corePoints = person => person.items.reduce((sum, item) => sum + (item.core === "core" || item.importance === "critical" ? RUBRIC[item.kind][item.importance][item.core] : 0), 0);
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * 跑 `contests` 场，每场对每组系数（和防刷开 / 关）各排一次名。返回每组的统计：
 * top8Share 各年级在前 8 名里的占比；p1 / p3 / p8 前 1 / 前 3 / 前 8 里至少有一个大一的概率；year1InTop8 前 8 里大一的平均人数；
 * spamTop8 / spamTop1 刷分的人进前 8 / 拿第一的概率；coreTop8 核心贡献（关键或核心的基础分）最多的人进前 8 的概率。
 */
export function simulate({ seed = 278, contests = 5000, model = MODELS.base, sets = FACTOR_SETS, rules = { 采用: DAMPING } } = {}) {
  const random = rng(seed);
  const variants = [];
  for (const [name, factors] of Object.entries(sets)) {
    for (const [ruleName, rule] of Object.entries(rules)) variants.push({ name, factors, ruleName, rule, stats: blank() });
  }
  // 「一个普通大三」：有贡献的大三的中位数（条数与基础分），大一每条有用贡献的平均基础分
  const year3Items = [];
  const year3Base = [];
  let year1Count = 0;
  let year1BaseSum = 0;
  for (let round = 0; round < contests; round++) {
    const people = contest(random, model);
    for (const person of people) {
      if (person.spammer || !person.items.length) continue;
      if (person.grade === "year3") { year3Items.push(person.items.length); year3Base.push(baseTotal(person)); }
      if (person.grade === "year1") { year1Count += person.items.length; year1BaseSum += baseTotal(person); }
    }
    let coreLeader = -1;
    let coreBest = 0;
    people.forEach((person, index) => { const value = person.spammer ? 0 : corePoints(person); if (value > coreBest) { coreBest = value; coreLeader = index; } });
    // 同分时随机排（真实天梯同分按报名先后，这里没有报名时间，随机等价）
    const tieBreak = people.map(() => random());
    for (const variant of variants) {
      const scored = people.map(person => totalOf(person, variant.factors, variant.rule));
      const totals = scored.map(([total]) => total);
      let legitBase = 0;
      let legitCut = 0;
      people.forEach((person, index) => { if (!person.spammer) { legitBase += baseTotal(person); legitCut += scored[index][1]; } });
      variant.stats.legitCut += legitBase ? legitCut / legitBase : 0;
      const ranked = people.map((_, index) => index).sort((a, b) => totals[b] - totals[a] || tieBreak[a] - tieBreak[b]);
      const top = ranked.slice(0, model.prizeSlots);
      const stats = variant.stats;
      for (const index of top) {
        if (people[index].spammer) stats.spamSlots++;
        else stats.top8[people[index].grade]++;
      }
      const isYear1 = index => people[index].grade === "year1";
      if (isYear1(ranked[0])) stats.p1++;
      if (ranked.slice(0, 3).some(isYear1)) stats.p3++;
      if (top.some(isYear1)) stats.p8++;
      stats.year1InTop8 += top.filter(isYear1).length;
      if (top.some(index => people[index].spammer)) stats.spamTop8++;
      if (people[ranked[0]].spammer) stats.spamTop1++;
      if (coreLeader >= 0) { stats.coreRounds++; if (top.includes(coreLeader)) stats.coreTop8++; }
    }
  }
  const typicalYear3Items = median(year3Items);
  const typicalYear3Base = median(year3Base);
  const year1BasePerItem = year1Count ? year1BaseSum / year1Count : 0;
  const round2 = value => Math.round(value * 100) / 100;
  const round3 = value => Math.round(value * 1000) / 1000;
  return {
    seed, contests, model: model.name,
    participantShare: Object.fromEntries(GRADES.map(grade => [grade, round3(model.population[grade] / 60)])),
    typicalYear3: { items: typicalYear3Items, base: typicalYear3Base },
    year1BasePerItem: round2(year1BasePerItem),
    variants: variants.map(({ name, factors, ruleName, stats }) => ({
      name, rule: ruleName,
      // 前 8 名的名额里各年级正常参赛者占的比例；刷分的人占的名额单列在 spamSlots
      top8Share: Object.fromEntries(GRADES.map(grade => [grade, round3(stats.top8[grade] / (contests * model.prizeSlots))])),
      spamSlots: round3(stats.spamSlots / (contests * model.prizeSlots)),
      p1: round3(stats.p1 / contests), p3: round3(stats.p3 / contests), p8: round3(stats.p8 / contests),
      year1InTop8: round2(stats.year1InTop8 / contests),
      spamTop8: round3(stats.spamTop8 / contests), spamTop1: round3(stats.spamTop1 / contests),
      coreTop8: round3(stats.coreTop8 / Math.max(1, stats.coreRounds)),
      legitCut: round3(stats.legitCut / contests),
      // 大一要超过一个普通大三：同样质量时只要 f3 / f1 倍的条数；按大一实际的平均每条分值算要多少条
      year1VsYear3: {
        sameQuality: round2(factors.year3 / factors.year1),
        items: round2(typicalYear3Base * factors.year3 / (factors.year1 * year1BasePerItem) / typicalYear3Items),
      },
    })),
  };
}
function blank() {
  return { top8: { year1: 0, year2: 0, year3: 0, year4: 0 }, p1: 0, p3: 0, p8: 0, year1InTop8: 0, spamTop8: 0, spamTop1: 0, coreTop8: 0, coreRounds: 0, legitCut: 0, spamSlots: 0 };
}

const pct = value => `${(value * 100).toFixed(1)}%`;
/** 一组结果打成 Markdown 表。 */
export function report(result, title) {
  const lines = [`#### ${title}`, ""];
  lines.push(`${result.model}；种子 ${result.seed}，${result.contests} 场。普通大三（有贡献的大三的中位数）${result.typicalYear3.items} 条有用贡献、基础分 ${result.typicalYear3.base}；大一每条有用贡献平均 ${result.year1BasePerItem} 分。`);
  lines.push("");
  lines.push("| 年级系数 | 防刷 | 前 8 名名额：大一 / 大二 / 大三 / 大四 / 刷分的人 | 第 1 名是大一 | 前 3 有大一 | 前 8 有大一 | 大一超过普通大三要做的条数（同质量 / 按大一平均分值） | 刷分的人进前 8 | 核心贡献最多的人进前 8 | 正常参赛者被防刷打掉的分 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const item of result.variants) {
    const share = [...GRADES.map(grade => pct(item.top8Share[grade])), pct(item.spamSlots)].join(" / ");
    lines.push(`| ${item.name} | ${item.rule} | ${share} | ${pct(item.p1)} | ${pct(item.p3)} | ${pct(item.p8)} | ${item.year1VsYear3.sameQuality} 倍 / ${item.year1VsYear3.items} 倍 | ${pct(item.spamTop8)} | ${pct(item.coreTop8)} | ${pct(item.legitCut)} |`);
  }
  return lines.join("\n");
}

function arg(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : fallback;
}

// 取 realpath：经符号链接的路径运行时 argv 与 import.meta.url 不同
if (process.argv[1] && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url) {
  const seed = arg("--seed", 278);
  const contests = arg("--contests", 5000);
  const chosenRule = Object.fromEntries(Object.entries(DAMPING_RULES).filter(([name]) => name.includes("采用")));
  const original = { [Object.keys(FACTOR_SETS)[0]]: Object.values(FACTOR_SETS)[0] };
  const chosenName = Object.entries(FACTOR_SETS).find(([, factors]) => GRADES.every(grade => factors[grade] === CHOSEN[grade]))?.[0] ?? "采用";
  console.log(`参赛 60 人：${GRADES.map(grade => `${LABELS[grade]} ${MODELS.base.population[grade]}`).join("、")}；其中 ${MODELS.base.spammers} 人专刷「一般 × 边缘」（每周提约 ${MODELS.base.spamPerWeek} 条，${pct(MODELS.base.spamUseful)} 被标有用）。前 8 名有奖。\n`);
  console.log(report(simulate({ seed, contests, model: MODELS.base, sets: FACTOR_SETS, rules: chosenRule }), "表 1　各组年级系数（防刷用采用的规则）"));
  console.log("");
  console.log(report(simulate({ seed, contests, model: MODELS.base, sets: { [chosenName]: CHOSEN }, rules: DAMPING_RULES }), "表 2　各种防刷规则（年级系数用采用的一组）"));
  console.log("");
  console.log(report(simulate({ seed, contests, model: MODELS.steep, sets: { ...original, [chosenName]: CHOSEN }, rules: { 不打折: null, ...chosenRule } }), "表 3　换一套假设：高年级多做一倍多"));
}
