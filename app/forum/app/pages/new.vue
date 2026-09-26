<script setup lang="ts">
import type { FormRules, TxFormInstance } from '@talex-touch/tuffex/form'
import type { TxSelectModelValue, TxSelectOption } from '@talex-touch/tuffex/select'
import { toast } from '@talex-touch/tuffex/utils'
import { UNAVAILABLE_COPY } from '~/data/access'
import { MEMBER_CONTENT_MAX, TOPIC_TAG_MAX, TOPIC_TITLE_MAX } from '../../shared/forum-api'

// Discourse composes a new topic in the same bottom panel as a reply; here it
// is a page of its own so the form can be deep-linked (and pre-filled from a
// category page), with the composer's field order kept.
useHead({ title: '新话题' })

const MIN_TITLE = 5
const MIN_CONTENT = 10

const route = useRoute()
const router = useRouter()
const forum = useForumStore()
const actions = useForumActions()
const { user, isLoggedIn, access, can } = useCurrentUser()
const { loginOpen } = useShell()
const { serverMode } = useContentSource()
const { signIn } = useSiteLinks()

/** Who may not post, and what they can do about it: pick an identity (demo), sign in (极客班论坛), or nothing. */
const blocked = computed(() => {
  switch (access.value.loginPrompt) {
    case 'pick-identity':
      return { title: '登录后才能发布话题', description: '选择一个身份即可发起新话题。', action: '登录' }
    case 'sign-in':
      return { title: '登录后才能发帖', description: '只有极客班成员能用 GitHub 登录。不登录也能看帖，也能在话题里回复。', action: '用 GitHub 登录' }
    case 'offline':
    case 'busy':
    case 'not-member':
      return { ...UNAVAILABLE_COPY[access.value.loginPrompt], action: '' }
    default:
      return { title: '发帖还没开放', description: '发帖正在接入。', action: '' }
  }
})

function onBlockedAction() {
  if (access.value.loginPrompt === 'sign-in')
    signIn()
  else
    loginOpen.value = true
}

const formRef = ref<TxFormInstance | null>(null)
const submitting = ref(false)
/** Set by the first submit; until then the form stays quiet. */
const submitted = ref(false)

const model = reactive({
  title: '',
  // Pre-selected when arriving from a category page (`/new?category=help`).
  categoryId: forum.categoryBySlug(String(route.query.category ?? ''))?.id ?? '',
  tagIds: [] as string[],
  content: '',
})

// The server's limits (title ≤120, ≤5 tags, body ≤20000) only apply against
// it; the demo keeps the upstream rules.
const rules: FormRules = {
  title: [
    { required: true, message: '请先写个标题' },
    { validator: value => String(value ?? '').trim().length >= MIN_TITLE, message: `标题至少 ${MIN_TITLE} 个字` },
    ...(serverMode ? [{ validator: (value: unknown) => String(value ?? '').trim().length <= TOPIC_TITLE_MAX, message: `标题最多 ${TOPIC_TITLE_MAX} 个字` }] : []),
  ],
  categoryId: [{ required: true, message: '请选择一个类别' }],
  ...(serverMode ? { tagIds: [{ validator: (value: unknown) => !Array.isArray(value) || value.length <= TOPIC_TAG_MAX, message: `标签最多 ${TOPIC_TAG_MAX} 个` }] } : {}),
  content: [
    { required: true, message: '请写点正文' },
    { validator: value => String(value ?? '').trim().length >= MIN_CONTENT, message: `正文至少 ${MIN_CONTENT} 个字` },
    ...(serverMode ? [{ validator: (value: unknown) => String(value ?? '').trim().length <= MEMBER_CONTENT_MAX, message: `正文最多 ${MEMBER_CONTENT_MAX} 字` }] : []),
  ],
}

const categoryOptions = computed<TxSelectOption[]>(() =>
  forum.state.categories.map(category => ({
    value: category.id,
    label: category.name,
    icon: category.icon,
    description: category.description,
  })))

// `allow-create` hands back the typed label as the value; `createTopic` reads
// any entry that is not a known tag id as a name and mints (or reuses) the tag.
const tagOptions = computed<TxSelectOption[]>(() =>
  forum.state.tags.map(tag => ({ value: tag.id, label: tag.name })))

function pickTags(value: TxSelectModelValue) {
  model.tagIds = (Array.isArray(value) ? value : [value]).map(String).filter(Boolean)
}

// TxFormItem only refreshes its message when the form is validated again, so a
// field that has just been filled in keeps showing "请先写个标题" until the next
// submit. Re-run the whole validation on every edit once the author has tried
// to submit — before that, typing must not raise errors under empty fields.
watch(model, () => {
  if (submitted.value)
    void formRef.value?.validate()
}, { deep: true })

function cancel() {
  if (router.options.history.state.back)
    router.back()
  else
    void router.push('/')
}

async function submit() {
  const current = user.value
  if (!current || !can('createTopic') || !formRef.value)
    return

  submitting.value = true
  submitted.value = true
  try {
    if (!await formRef.value.validate())
      return

    const topicId = await actions.createTopic({
      title: model.title.trim(),
      categoryId: model.categoryId,
      tagIds: [...model.tagIds],
      content: model.content.trim(),
      authorId: current.id,
    })
    if (!topicId)
      return
    toast({ title: '话题已发布', variant: 'success' })
    await router.push(`/t/${topicId}`)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <TxCard>
    <TxEmptyState
      v-if="!isLoggedIn"
      variant="permission"
      :title="blocked.title"
      :description="blocked.description"
      :primary-action="blocked.action ? { label: blocked.action, variant: 'primary', icon: access.loginPrompt === 'sign-in' ? 'i-carbon-logo-github' : undefined } : undefined"
      @primary="onBlockedAction"
    />

    <TxForm
      v-else
      ref="formRef"
      :model="model"
      :rules="rules"
      label-position="top"
    >
      <!--
        `.tx-form-item` is `align-items: flex-start`, so in label-top mode every
        control keeps its intrinsic width; the scoped rule outranks a plain
        utility, hence the important variant.
      -->
      <TxFormItem label="标题" prop="title" class="!items-stretch">
        <TxInput
          v-model="model.title"
          placeholder="输入标题，说清楚这个话题是什么"
          clearable
        />
      </TxFormItem>

      <TxFlex :gap="12" wrap="wrap">
        <TxFormItem label="类别" prop="categoryId">
          <TxSelect
            v-model="model.categoryId"
            :options="categoryOptions"
            placeholder="选择一个类别"
          />
        </TxFormItem>

        <TxFormItem label="标签（可选）" prop="tagIds">
          <TxSelect
            :model-value="model.tagIds"
            :options="tagOptions"
            placeholder="添加标签"
            multiple
            searchable
            allow-create
            create-text="创建这个标签"
            search-placeholder="搜索或新建标签"
            empty-text="没有匹配的标签"
            @update:model-value="pickTags"
          />
        </TxFormItem>
      </TxFlex>

      <TxFormItem label="正文" prop="content" class="!items-stretch">
        <PostEditor
          v-model="model.content"
          :min-height="320"
          placeholder="在这里输入内容…"
          label="话题正文"
        />
      </TxFormItem>

      <TxFlex justify="flex-end" :gap="8">
        <TxButton variant="secondary" @click="cancel">
          取消
        </TxButton>
        <TxButton variant="primary" :loading="submitting" @click="submit">
          创建话题
        </TxButton>
      </TxFlex>
    </TxForm>
  </TxCard>
</template>
