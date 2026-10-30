---
name: release-parity
description: "geek_main 发版、hotfix 与环境改动的同构核对。动 env 模板、密钥、部署工作流、宿主配置（Caddy/GitLab/nginx）、外部服务，或要打 rc/正式 tag、派发 deploy-hotfix，或用户提到预发布与正式不同步、要在发正式前先查一遍时使用。"
---

# 预发布到正式的同构核对（geek_main）

规则正文归 [`docs/conventions/RELEASE-PARITY.md`](../../../docs/conventions/RELEASE-PARITY.md)：三份 env 的隔离、不在代码里写另一个环境的地址、五个同构面、无损迁移流程、同构清单、发版烟测。冲突时以规范为准，这里只给开工与收工的可执行命令，不复制正文。

## 开工前

```bash
git branch --show-current
node scripts/parity.mjs list              # 看哪些条目还是 pending
pnpm check:env-isolation                  # 三份 env 与代码里的环境域名
```

读对应环境的模板：`deploy/env/.env.production`、`.env.preview`、`.env.dev`。

## 做事的时候

- 对齐的是接口和表结构；数据只对齐格式，内容各环境自有，不复制预发布的行或数据库文件到正式。`data` 条目登记的是旧行形状的迁移、代码要求必须存在的记录的字段形状，值取正式自己的。
- 要用到地址、端口、签发者、镜像仓库：从 env 文件或 `deploy/environments.json` 读；宿主片段读宿主上的文件。不写另一个环境的域名。
- 在预发布做了不在提交里的事（表结构的手工步骤、数据格式、env 键与密钥、宿主配置、外部服务），当场登记：

  ```bash
  node scripts/parity.mjs add --surface <schema|data|env|host|external> --title "…" --issue <编号> \
    --preview-evidence "预发布做了什么、怎么验证的" --production-action "正式要做的动作和命令"
  ```

- 要在宿主或线上库上做的事，先在仓库里补流水线路径和 CI 测试（`deploy/remote/install-host.sh`、`gitlab-cutover.yml` 这类），清单条目的正式动作写那条路径；不要靠自己或别人登录目标机去改，开发者没有 SSH。
- 在正式做完：`node scripts/parity.mjs done <P-编号> --evidence "…"`。确实不需要写 `not-applicable --reason`。豁免只有所有者能给：`waive --by 所有者 --approval "批准摘要"`，没有批准摘要不写。

## 发版或 hotfix 前后

```bash
node scripts/parity.mjs check --release --version <x.y.z>                  # 部署前的条目必须清零，否则 parity job 会拒绝构建；本版本的 post_deploy 只列出，更早版本遗留的会拦
node scripts/parity.mjs check --complete                                  # 部署完成后收尾：全部清零
node scripts/parity.mjs smoke --origin <站点> --env <production|preview>  # 部署后，含内部赛事官网
node scripts/parity.mjs compare --preview <预发布站点> --production <正式站点>  # 晋升同一提交时
```

报告里单独列出 `pending`、没跑的检查和依赖所有者的动作（DNS、密钥、第三方后台），不写成已完成。

## 不要做

- 为了让检查通过去扩大 `deploy/env/origin-exceptions.json`、放宽 `scripts/check-env-isolation.mjs`、`scripts/parity.mjs`、`deploy/parity/smoke.json`。
- 把「预发布没问题」当成「正式也做了」；预发布做了而正式没做就打正式 tag 或派发 hotfix。
- 手写对正式库的 UPDATE、手工改运行中的栈、替所有者豁免或验收。
