---
id: t910
slug: organizer-contest-sdk-quickstart
title: 用 SDK 接入比赛官网
audience: 比赛组织者
visibility: member
order: 10
date: 2026-10-25
---

这篇给要给自己的比赛做一个官网、又想在上面显示报名人数、天梯和奖项的成员看。比赛官网在隔离环境里运行，读不到主站的登录状态，只能用这个 SDK 读公开数据，不用自己拼接口地址。

1. 在控制台「比赛」列表里找到这场比赛，记下它的比赛 id（内部比赛的地址或「报名、积分与官网」链接里能看到）。

![控制台比赛列表，能看到比赛 id](https://cdn.crosery.com/yzgc/static/site/forum/guides/console-competitions-list.gPcWPlY6.webp)

2. 在自己的站点包里用 ES module 的方式加载 SDK，不用安装任何依赖：

```html
<script type="module">
  import { createClient } from "/sdk/competition/v1.js";
  const client = createClient({ competition: "<比赛 id>" });

  function render(snapshot) {
    // snapshot.leaderboard.individuals 是天梯
    // snapshot.stats.participants / stats.teams 是报名人数和组队数
    // snapshot.competition.prizes 是奖项列表
  }

  client.getSnapshot().then(render);
  client.subscribe((update) => {
    if (!("error" in update)) render(update);
  });
</script>
```

3. `getSnapshot()` 一次性拿到比赛信息、天梯、动态和统计；`subscribe(callback)` 按固定间隔自动轮询，页面切到后台会暂停，回到前台立刻补一次，失败不会抛错，回调里会拿到 `{ error }`，错误码只有四种：`network`（连不上）、`not_found`（比赛 id 不对）、`rate_limited`（太频繁，等 `retry_after` 秒）、`server`（服务端出错）。要列出全部报名的人和全部队伍，用 `getParticipants()`（分页，带 `next_cursor`）和 `getTeams()`；个人赛的 `getTeams()` 返回 `enabled: false` 和空列表，不会报错，页面据此跳过队伍那一段。
4. 想加「报名」「组队」按钮，分别用 `client.signupUrl()`、`client.teamUrl()` 拿到地址，这两个地址会把访客带回主站的比赛窗口，不用自己拼。
5. 下面是一个能直接用的完整页面：显示比赛名、报名人数、组队数、天梯和奖项，带报名和组队按钮。放进站点包当 `index.html`，把比赛 id 换成自己的就能用。想在本机先看效果，最省事的是从起步模板 `app/web/sites/contests/_starter` 开始，构建后用 `pnpm contest:site dev <构建产物目录>` 预览：默认用示例数据，加 `--api <预发布站点地址>` 就读预发布上这场比赛的真实公开数据，不用自己写样例。

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>比赛官网</title></head>
<body>
  <h1 id="name">正在读取…</h1>
  <p>报名人数 <b id="participants">-</b>，组队数 <b id="teams">-</b></p>
  <p><a id="signup" target="_blank">去报名</a> <a id="team" target="_blank">去组队</a></p>
  <h2>天梯</h2>
  <ol id="ladder"></ol>
  <h2>奖项</h2>
  <ul id="prizes"></ul>
  <p id="error"></p>
  <script type="module">
    import { createClient } from "/sdk/competition/v1.js";
    const client = createClient({ competition: "<比赛 id>", origin: "" });
    const $ = (id) => document.getElementById(id);
    $("signup").href = client.signupUrl();
    $("team").href = client.teamUrl();

    function list(id, items) {
      $(id).replaceChildren(...items.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    }
    function render(snapshot) {
      $("error").textContent = "";
      $("name").textContent = snapshot.competition.name;
      $("participants").textContent = snapshot.stats.participants;
      $("teams").textContent = snapshot.stats.teams;
      list("ladder", snapshot.leaderboard.individuals.map((p) => `${p.display_name}（${p.team_name ?? "个人"}）${p.score} 分`));
      list("prizes", snapshot.competition.prizes.map((t) => `第 ${t.from}–${t.to} 名：${t.amount_cny} 元 ${t.title}`));
    }
    const messages = { network: "网络连不上", not_found: "比赛 id 不对", rate_limited: "请求太频繁，稍后再试", server: "服务暂时不可用" };
    client.subscribe((update) => {
      if (update.error) $("error").textContent = messages[update.error.code];
      else render(update);
    });
  </script>
</body>
</html>
```

6. 写完页面后打包成 zip（根目录要有 `index.html` 和 `yzgc-site.json`，最大 20MB、最多 500 个文件，只能引用站点包自己带的文件），到控制台这场比赛的「官网」页签上传、预览、发布，具体步骤见《比赛官网：上传站点包》。
