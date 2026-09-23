<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { TxCard } from "@talex-touch/tuffex/card";
import { TxMarkdownView } from "@talex-touch/tuffex/markdown-view";
import { TxTextarea } from "@talex-touch/tuffex/textarea";
import { TxButton } from "@talex-touch/tuffex/button";
import { TxSelect } from "@talex-touch/tuffex/select";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxAlert } from "@talex-touch/tuffex/alert";
import { TxAvatar } from "@talex-touch/tuffex/avatar";
import { toast } from "@talex-touch/tuffex/utils";
import ErrorPanel from "../../../components/ErrorPanel.vue";
import ErrorAlert from "../../../components/ErrorAlert.vue";
import LoadingBlock from "../../../components/LoadingBlock.vue";
import DiffBlock from "./DiffBlock.vue";
import { api, jsonBody } from "../../../lib/http";
import { confirm } from "../../../lib/confirm";
import { fmtDate, fmtRelative } from "../../../lib/format";
import { useAction, useResource } from "../../../lib/resource";
import type { Comment, FileChange, Label, Person } from "./types";

type Detail = {
  number: number; title: string; body: string | null; state: "open" | "closed"; user: Person; labels?: Label[]; created_at: string; html_url: string; comments: Comment[];
  merged?: boolean; mergeable?: boolean | null; draft?: boolean; head?: { ref: string; sha: string }; base?: { ref: string };
  additions?: number; deletions?: number; changed_files?: number; files?: FileChange[];
};

/** Issue 或合并请求详情：正文（Markdown，默认净化）、评论、评论/关闭/重开，合并请求另有改动与合并。 */
const props = defineProps<{ kind: "issue" | "pr"; repoApi: string; number: string; back: string }>();
const router = useRouter();
const url = computed(() => `${props.repoApi}/${props.kind === "issue" ? "issues" : "pulls"}/${props.number}`);
const detail = useResource(() => api<Detail>(url.value), [url]);
const noun = computed(() => (props.kind === "issue" ? "Issue" : "合并请求"));

const body = ref("");
const comment = useAction(async () => {
  await api(`${props.repoApi}/issues/${props.number}/comments`, { method: "POST", ...jsonBody({ body: body.value }) });
  body.value = "";
  toast({ title: "评论已发出", variant: "success" });
  await detail.reload();
});
const setState = useAction(async (target: "open" | "closed") => {
  if (body.value.trim()) await api(`${props.repoApi}/issues/${props.number}/comments`, { method: "POST", ...jsonBody({ body: body.value }) });
  await api(`${props.repoApi}/issues/${props.number}`, { method: "PATCH", ...jsonBody({ state: target }) });
  body.value = "";
  toast({ title: target === "closed" ? `${noun.value}已关闭` : `${noun.value}已重新打开`, variant: "success" });
  await detail.reload();
});
async function askClose() {
  if (await confirm({ title: `关闭 #${props.number}？`, body: body.value.trim() ? "会先发出你写的评论，再关闭。" : undefined, confirmText: body.value.trim() ? "评论并关闭" : "关闭" })) await setState.execute("closed");
}

const method = ref<"merge" | "squash" | "rebase">("merge");
const methodOptions = [{ value: "merge", label: "合并提交" }, { value: "squash", label: "压缩后合并" }, { value: "rebase", label: "变基后合并" }];
const merge = useAction(async () => {
  const d = detail.data.value!;
  await api(`${url.value}/merge`, { method: "PUT", ...jsonBody({ merge_method: method.value, sha: d.head?.sha }) });
  toast({ title: "已合并", variant: "success" });
  await detail.reload();
});
async function askMerge() {
  const d = detail.data.value!;
  if (await confirm({ title: `合并 #${props.number}？`, body: `把 ${d.head?.ref} 合入 ${d.base?.ref}。只合并你看到的这个版本（${d.head?.sha.slice(0, 7)}），期间有新推送会被拒绝。`, confirmText: "合并" })) await merge.execute();
}
const openExternal = (href: string) => window.open(href, "_blank", "noopener");
const stateText = computed(() => {
  const d = detail.data.value;
  if (!d) return "";
  return d.merged ? "已合并" : d.state === "open" ? (d.draft ? "草稿" : "未关闭") : "已关闭";
});
</script>

<template>
  <div class="thread">
    <div><TxButton variant="ghost" size="sm" icon="i-carbon-arrow-left" @click="router.push(back)">返回{{ noun }}列表</TxButton></div>
    <ErrorPanel v-if="detail.error.value" :error="detail.error.value" :retry="detail.reload" />
    <LoadingBlock v-else-if="!detail.data.value" :lines="10" />
    <template v-else>
      <TxCard>
        <div class="head">
          <h2>{{ detail.data.value.title }} <span class="muted mono">#{{ detail.data.value.number }}</span></h2>
          <TxButton size="sm" icon="i-carbon-launch" @click="openExternal(detail.data.value.html_url)">在 GitHub 打开</TxButton>
        </div>
        <p class="meta">
          <TxTag :label="stateText" size="sm" variant="soft" />
          <span class="mono">@{{ detail.data.value.user.login }}</span>
          <span class="muted">{{ fmtDate(detail.data.value.created_at) }}</span>
          <span v-if="detail.data.value.head" class="mono muted">{{ detail.data.value.head.ref }} 合入 {{ detail.data.value.base?.ref }}</span>
          <TxTag v-for="label in detail.data.value.labels ?? []" :key="label.name" :label="label.name" :color="`#${label.color}`" size="sm" variant="soft" />
        </p>
        <TxMarkdownView v-if="detail.data.value.body" :content="detail.data.value.body" theme="light" class="md" />
        <p v-else class="muted">没有正文。</p>
      </TxCard>

      <DiffBlock v-if="detail.data.value.files?.length" :files="detail.data.value.files" />

      <h3 class="section-title">评论（{{ detail.data.value.comments.length }}）</h3>
      <TxCard v-for="item in detail.data.value.comments" :key="item.id">
        <p class="comment-meta">
          <TxAvatar :src="item.user.avatar_url ?? undefined" :name="item.user.login" :size="20" />
          <span class="mono">@{{ item.user.login }}</span>
          <span class="muted">{{ fmtRelative(item.created_at) }}</span>
        </p>
        <TxMarkdownView :content="item.body ?? ''" theme="light" class="md" />
      </TxCard>
      <p v-if="!detail.data.value.comments.length" class="muted">还没有评论。</p>

      <TxCard v-if="kind === 'pr' && detail.data.value.state === 'open' && !detail.data.value.merged">
        <TxAlert v-if="detail.data.value.mergeable === false" type="error" :closable="false" title="不能自动合并" message="有冲突或缺少必需的审查。请先在 GitHub 上处理。" />
        <div v-else class="merge">
          <span>把 <span class="mono">{{ detail.data.value.head?.ref }}</span> 合入 <span class="mono">{{ detail.data.value.base?.ref }}</span></span>
          <TxSelect v-model="method" :options="methodOptions" class="merge__method" />
          <TxButton variant="primary" :loading="merge.pending.value" @click="askMerge">合并</TxButton>
        </div>
        <ErrorAlert v-if="merge.error.value" :error="merge.error.value" @close="merge.reset()" />
      </TxCard>

      <TxCard>
        <TxTextarea v-model="body" :rows="4" placeholder="写评论，支持 Markdown" />
        <ErrorAlert v-if="comment.error.value || setState.error.value" :error="comment.error.value ?? setState.error.value" class="composer-error" @close="comment.reset(); setState.reset()" />
        <div class="composer">
          <TxButton v-if="detail.data.value.state === 'open' && !detail.data.value.merged" :loading="setState.pending.value" @click="askClose">{{ body.trim() ? "评论并关闭" : "关闭" }}</TxButton>
          <TxButton v-else-if="!detail.data.value.merged" :loading="setState.pending.value" @click="setState.execute('open')">{{ body.trim() ? "评论并重新打开" : "重新打开" }}</TxButton>
          <TxButton variant="primary" :disabled="!body.trim()" :loading="comment.pending.value" @click="comment.execute()">评论</TxButton>
        </div>
      </TxCard>
    </template>
  </div>
</template>

<style scoped>
.thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.meta,
.comment-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: 8px 0 12px;
  font-size: 13px;
}
.comment-meta {
  margin-top: 0;
}
.md {
  overflow-wrap: anywhere;
}
.merge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.merge__method {
  width: 180px;
}
.composer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.composer-error {
  margin-top: 12px;
}
</style>
