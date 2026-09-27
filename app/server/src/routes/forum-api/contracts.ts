import { object, text, type RouteContracts } from "../../lib/http-contracts.js";
import { FORUM_LIMITS } from "../../lib/forum-rules.js";
import type { forumChanges } from "./viewer.js";

/**
 * `/api/forum/*` 的输入协议源（#57）。所有 body 都拒绝未知字段。编号是字符串（t73、p10001、body-73、m123、g4、n9），
 * 路径参数不叫 `:id`，因为公共校验会把 `:id` 强制成数字。长度按 UTF-16 计（与浏览器里 `String.length` 一致），
 * 去掉首尾空白后的判断在路由里做。
 */
/**
 * 输出协议（#145）。GET /api/forum/state 回 `{ state }`：整份 ForumState，加 `viewer`、`guestPolicy`。
 * 写接口不再回整份状态，一律回 {@link ForumWriteResponse}：`changes` 里只有这次写入改动的记录（lib/forum-store.ts 的
 * ForumChanges，每条与 /state 里同一条完全一样，可见性也一样），前端 app/forum/shared/forum-api.ts 的 `parseWriteResult`
 * 按同一形状解析，按 id 并进手里的状态。POST /topics 另带 `topicId`、`postId`，POST /posts 另带 `postId`（这两个是 201，其余 200）。
 *
 * - POST /topics：新话题、首帖、话题用到的标签
 * - POST /posts：新帖子和它所在的话题（最后活动时间变了）；游客回复另带这次新建的游客用户
 * - PATCH、DELETE /posts/:post_id，POST /posts/:post_id/like：这条帖子
 * - POST /posts/:post_id/bookmark：自己对这条帖子的书签，取消了就在 `removed.bookmarks`
 * - POST /users/:forum_user_id/follow：这条关注，取消了就在 `removed.follows`
 * - POST /topics/:topic_id/pin、/close：这个话题
 * - POST /notifications/:notification_id/read：这条通知；/notifications/read-all：这次从未读变成已读的通知
 * - PATCH /me/profile、PUT 和 DELETE /me/avatar：只有下面这条
 *
 * 成员的回答总带自己的用户记录：每次请求都会刷新角色、称号和 GitHub 头像。别人收到的通知不在回答里。
 */
export type ForumWriteResponse = ReturnType<typeof forumChanges> & { topicId?: string; postId?: string };

export const TOPIC_ID_PATTERN = "^t[1-9][0-9]{0,8}$";
export const POST_ID_PATTERN = "^(?:p[1-9][0-9]{0,9}|body-[1-9][0-9]{0,8})$";
export const USER_ID_PATTERN = "^(?:m[1-9][0-9]{0,14}|g[1-9][0-9]{0,9}|u-[a-z0-9-]{1,32})$";
const pattern = (source: string) => ({ type: "string", pattern: source });
const flag = { type: "boolean" };
const topicParams = { params: object({ topic_id: pattern(TOPIC_ID_PATTERN) }, ["topic_id"]) };
const postParams = { params: object({ post_id: pattern(POST_ID_PATTERN) }, ["post_id"]) };

export const forumContracts: RouteContracts = {
  "POST /api/forum/topics": {
    body: object({
      title: text(FORUM_LIMITS.titleMax, 1),
      categoryId: pattern("^[a-z0-9][a-z0-9-]{0,39}$"),
      tags: { type: "array", items: text(40, 1), maxItems: FORUM_LIMITS.tagsMax },
      content: text(FORUM_LIMITS.memberContentMax, 1),
    }, ["title", "categoryId", "content"]),
  },
  "POST /api/forum/posts": {
    body: object({
      topicId: pattern(TOPIC_ID_PATTERN),
      // 成员上限；游客的 2000 字在路由里判断（同一个接口，身份决定上限）。
      content: text(FORUM_LIMITS.memberContentMax, 1),
      replyToPostId: pattern(POST_ID_PATTERN),
      guest: object({ name: text(FORUM_LIMITS.guestNameMax, 1) }, ["name"]),
      pow: object({ timestamp: { type: "number" }, nonce: text(32, 1) }, ["timestamp", "nonce"]),
      // 蜜罐：前端渲染成隐藏输入框，真人留空。
      website: text(2000),
      turnstileToken: text(4096),
    }, ["topicId", "content"]),
  },
  "PATCH /api/forum/posts/:post_id": { ...postParams, body: object({ content: text(FORUM_LIMITS.memberContentMax, 1) }, ["content"]) },
  "DELETE /api/forum/posts/:post_id": postParams,
  "POST /api/forum/posts/:post_id/like": postParams,
  "POST /api/forum/posts/:post_id/bookmark": postParams,
  "POST /api/forum/users/:forum_user_id/follow": { params: object({ forum_user_id: pattern(USER_ID_PATTERN) }, ["forum_user_id"]) },
  "POST /api/forum/topics/:topic_id/pin": { ...topicParams, body: object({ pinned: flag }, ["pinned"]) },
  "POST /api/forum/topics/:topic_id/close": { ...topicParams, body: object({ closed: flag }, ["closed"]) },
  "POST /api/forum/topics/:topic_id/view": topicParams,
  "POST /api/forum/notifications/:notification_id/read": { params: object({ notification_id: pattern("^n[1-9][0-9]{0,9}$") }, ["notification_id"]) },
  "PATCH /api/forum/me/profile": {
    body: {
      ...object({
        displayName: text(FORUM_LIMITS.displayNameMax, 1),
        bio: text(FORUM_LIMITS.bioMax),
        location: text(FORUM_LIMITS.locationMax),
        website: text(FORUM_LIMITS.websiteMax),
        notifyPrefs: object({ reply: flag, like: flag, follow: flag }),
      }),
      minProperties: 1,
    },
  },
  "GET /api/forum/avatars/:file": { params: object({ file: pattern("^[0-9a-f]{64}\\.webp$") }, ["file"]) },
};

const FIELD_LABELS: Record<string, string> = {
  title: "标题", categoryId: "分类", tags: "标签", content: "正文", topicId: "话题", replyToPostId: "被回复的帖子",
  guest: "游客信息", name: "昵称", pow: "防滥用校验", timestamp: "防滥用校验", nonce: "防滥用校验", website: "个人网站",
  turnstileToken: "人机验证", displayName: "昵称", bio: "个人签名", location: "所在地", notifyPrefs: "通知设置",
  reply: "通知设置", like: "通知设置", follow: "通知设置", pinned: "置顶", closed: "关闭",
};

type SchemaError = { keyword: string; instancePath: string; params: Record<string, unknown> };

/** 校验失败时给中文说明（论坛前端直接弹出 message）。机器码仍是 validation_error。 */
export function forumValidationMessage(errors: SchemaError[], dataVar: string): string {
  const [first] = errors;
  if (!first) return "请求参数不对";
  if (dataVar === "params") return "链接里的编号不对";
  if (dataVar !== "body") return "请求参数不对";
  if (first.keyword === "additionalProperties") return `不认识的字段：${String(first.params.additionalProperty)}`;
  if (first.keyword === "minProperties") return "没有要修改的内容";
  const field = first.keyword === "required" ? String(first.params.missingProperty) : first.instancePath.split("/").filter(Boolean).filter(part => !/^\d+$/.test(part)).pop();
  const label = (field && FIELD_LABELS[field]) ?? "请求内容";
  switch (first.keyword) {
    case "required": return `缺少${label}`;
    case "minLength": return `${label}不能为空`;
    case "maxLength": return `${label}太长了，最多 ${String(first.params.limit)} 个字`;
    case "maxItems": return `${label}最多 ${String(first.params.limit)} 个`;
    default: return `${label}的格式不对`;
  }
}
