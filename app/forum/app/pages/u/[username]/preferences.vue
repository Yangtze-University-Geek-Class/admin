<script setup lang="ts">
import type { FileUploaderFile } from '@talex-touch/tuffex/file-uploader'
import { toast } from '@talex-touch/tuffex/utils'
import { AVATAR_PALETTE } from '~/data/seed-content'
import { AVATAR_TYPES, avatarFileProblem, PROFILE_LIMITS, websiteProblem } from '../../../../shared/forum-api'

// Discourse's /u/<name>/preferences: a left-hand sub-navigation over the form.
// Only your own; somebody else's redirects back to their profile.
//
// Against the forum server (极客班论坛) this is the account profile: 昵称,
// 个人签名, 所在地, 个人网站 and the notification switches go to
// PATCH /api/forum/me/profile, and the avatar is a picture — uploaded (PUT the
// file itself) or the GitHub one — instead of the demo's initials colour.
definePageMeta({
  key: route => route.path,
})

const route = useRoute()
const router = useRouter()
const forum = useForumStore()
const actions = useForumActions()
const { user: viewer, isLoggedIn, can } = useCurrentUser()
const { serverMode } = useContentSource()
const colorMode = useColorMode()

const username = String(route.params.username)
// Read through the store, not captured: 重置示例数据 replaces the whole state and
// the saved values have to come from the tree the store actually writes to.
const profile = computed(() => forum.userByUsername(username))

if (!profile.value) {
  showError(createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message: '这个用户不存在，用户名可能拼错了。',
    fatal: true,
  }))
}

useHead({ title: () => (profile.value ? `${profile.value.displayName} 的偏好设置` : '偏好设置') })

const isSelf = computed(() => !!profile.value && !!viewer.value && can('editProfile', { targetUser: profile.value }))

// Edits are staged here and only reach the store on 保存更改, so leaving the
// page (or hitting 放弃修改) changes nothing.
const draft = reactive({
  displayName: profile.value?.displayName ?? '',
  bio: profile.value?.bio ?? '',
  location: profile.value?.location ?? '',
  website: profile.value?.website ?? '',
  avatarColor: profile.value?.avatarColor ?? '',
  notifyPrefs: { ...(profile.value?.notifyPrefs ?? { reply: true, like: true, follow: true }) },
})

// ------------------------------------------------------------ server avatar

/**
 * The picked file, kept here rather than in the uploader: its file row has a
 * remove button whose icon does not render, so the uploader only picks and
 * this page shows the preview (a data: URL; the site CSP allows data: images,
 * not blob:) with its own 不用这张.
 */
const avatarFile = shallowRef<File | null>(null)
const avatarPreview = ref('')
const avatarBusy = ref(false)
const uploadedAvatar = computed(() => profile.value?.avatarUrl?.startsWith('/api/forum/avatars/') ?? false)
/** Bumped on every pick or discard, so a slow FileReader never shows a file that is no longer picked. */
let avatarPick = 0

function pickAvatar(next: FileUploaderFile[]) {
  const picked = next.at(-1)?.file
  if (!picked)
    return
  const problem = avatarFileProblem(picked)
  if (problem) {
    toast({ title: '这张图片不能用', description: problem, variant: 'warning' })
    return
  }
  const pick = ++avatarPick
  avatarFile.value = picked
  avatarPreview.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    if (pick === avatarPick && typeof reader.result === 'string')
      avatarPreview.value = reader.result
  }
  reader.readAsDataURL(picked)
}

function discardAvatar() {
  avatarPick += 1
  avatarFile.value = null
  avatarPreview.value = ''
}

async function uploadAvatar() {
  const file = avatarFile.value
  if (!file || avatarBusy.value)
    return
  avatarBusy.value = true
  try {
    if (!await actions.uploadAvatar(file))
      return
    discardAvatar()
    toast({ title: '头像已更换', variant: 'success' })
  }
  finally {
    avatarBusy.value = false
  }
}

async function resetAvatar() {
  if (avatarBusy.value)
    return
  avatarBusy.value = true
  try {
    if (await actions.resetAvatar())
      toast({ title: '已恢复 GitHub 头像', variant: 'success' })
  }
  finally {
    avatarBusy.value = false
  }
}

/** A live user object for the avatar previews, without touching the store. */
const preview = computed(() => (profile.value
  ? {
      ...profile.value,
      displayName: draft.displayName || profile.value.displayName,
      avatarColor: draft.avatarColor,
      ...(avatarPreview.value ? { avatarUrl: avatarPreview.value } : {}),
    }
  : undefined))

// Somebody else's preferences page is not a 403 in Discourse either — it just
// sends you to their profile. Done in setup, with the form behind a `v-if`, so
// the redirect never renders a frame of the form.
if (profile.value && !isSelf.value && isLoggedIn.value)
  void router.replace(`/u/${profile.value.username}`)

function revert() {
  const current = profile.value
  if (!current)
    return
  draft.displayName = current.displayName
  draft.bio = current.bio
  draft.location = current.location
  draft.website = current.website
  draft.avatarColor = current.avatarColor
  draft.notifyPrefs = { ...current.notifyPrefs }
}

/** The server's limits, checked before sending so the answer is not a bare 400. */
function profileProblem(): string | null {
  const displayName = draft.displayName.trim()
  if (displayName.length > PROFILE_LIMITS.displayName)
    return `昵称最多 ${PROFILE_LIMITS.displayName} 个字。`
  if (draft.bio.trim().length > PROFILE_LIMITS.bio)
    return `个人签名最多 ${PROFILE_LIMITS.bio} 个字。`
  if (draft.location.trim().length > PROFILE_LIMITS.location)
    return `所在地最多 ${PROFILE_LIMITS.location} 个字。`
  return websiteProblem(draft.website.trim())
}

const saving = ref(false)

async function save() {
  const current = profile.value
  if (!current || !isSelf.value || saving.value)
    return
  const problem = serverMode ? profileProblem() : null
  if (problem) {
    toast({ title: '资料没有保存', description: problem, variant: 'warning' })
    return
  }
  saving.value = true
  try {
    const saved = await actions.updateProfile(current.id, {
      displayName: draft.displayName.trim() || current.displayName,
      bio: draft.bio.trim(),
      location: draft.location.trim(),
      website: draft.website.trim(),
      avatarColor: draft.avatarColor,
      notifyPrefs: { ...draft.notifyPrefs },
    })
    if (saved)
      toast({ title: serverMode ? '资料已保存' : '偏好设置已保存', variant: 'success' })
  }
  finally {
    saving.value = false
  }
}

/**
 * The theme is not profile data — it belongs to this browser, and a switch
 * that only takes effect after 保存更改 would be a worse control than the one
 * in the header. So it writes straight through.
 */
function setTheme(value: string | number) {
  colorMode.preference = String(value)
}
</script>

<template>
  <TxCard v-if="profile && !isLoggedIn">
    <SignInState page="preferences" />
  </TxCard>

  <TxStack v-else-if="profile && isSelf" :gap="16">
    <TxFlex align="center" :gap="8" wrap="wrap">
      <h1 class="text-xl font-semibold">
        {{ serverMode ? '账号资料' : '偏好设置' }}
      </h1>
      <span class="text-$tx-text-color-secondary">@{{ profile.username }}</span>
    </TxFlex>

    <TxCard :padding="0">
      <!--
        `default-value` is not optional: without a model naming one of its
        children TxTabs selects nothing and renders its own English
        "No tab selected" placeholder.
      -->
      <TxTabs placement="left" default-value="profile" :nav-min-width="140">
        <TxTabItem name="profile" icon-class="i-carbon-user">
          <template #name>
            个人资料
          </template>

          <TxGroupBlock name="个人资料" description="这些信息会显示在你的主页上。" :collapsible="false">
            <TxBlockInput
              v-model="draft.displayName"
              title="昵称"
              :description="serverMode ? `列表和帖子里显示的名字，最多 ${PROFILE_LIMITS.displayName} 个字；登录名 @${profile.username} 不变` : '列表和帖子里显示的名字'"
              placeholder="你的昵称"
              clearable
            />
            <!-- The server keeps line breaks in a signature, so it gets a textarea; the demo keeps upstream's one-line field. -->
            <TxBlockInput
              v-model="draft.bio"
              title="个人签名"
              :description="serverMode ? `显示在你的主页上，可以换行，最多 ${PROFILE_LIMITS.bio} 个字（现在 ${draft.bio.trim().length} 个）` : '一句话介绍自己'"
              placeholder="比如：计科 2024 级，在学前端"
              clearable
            >
              <template v-if="serverMode" #control>
                <TxInput v-model="draft.bio" type="textarea" :rows="3" placeholder="比如：计科 2024 级，在学前端" aria-label="个人签名" />
              </template>
            </TxBlockInput>
            <TxBlockInput
              v-model="draft.location"
              title="所在地"
              description="可选"
              placeholder="比如：杭州"
              clearable
            />
            <TxBlockInput
              v-model="draft.website"
              :title="serverMode ? '个人网站' : '网站'"
              :description="serverMode ? '可选，以 https:// 开头，会作为链接显示' : '可选，会作为链接显示'"
              placeholder="https://example.com"
              clearable
            />
          </TxGroupBlock>
        </TxTabItem>

        <TxTabItem name="avatar" icon-class="i-carbon-user-avatar">
          <template #name>
            头像
          </template>

          <TxStack v-if="serverMode" :gap="16">
            <TxFlex align="center" :gap="12">
              <UserAvatar v-if="preview" :user="preview" size="xlarge" />
              <TxStack :gap="4">
                <span class="font-medium">{{ avatarFile ? '新头像预览' : '现在的头像' }}</span>
                <span class="text-sm text-$tx-text-color-secondary">
                  {{ avatarFile ? `${avatarFile.name}，点「上传头像」才会换上；服务器会把它裁成正方形。` : uploadedAvatar ? '这是你上传的头像。' : '这是你的 GitHub 头像。' }}
                </span>
              </TxStack>
            </TxFlex>

            <TxFileUploader
              :model-value="[]"
              :multiple="false"
              :max="1"
              :accept="AVATAR_TYPES.join(',')"
              button-text="选择图片"
              drop-text="把图片拖到这里"
              hint-text="PNG、JPEG 或 WebP，不超过 2MB"
              @update:model-value="pickAvatar"
            />

            <TxFlex :gap="8" wrap="wrap">
              <TxButton variant="primary" icon="i-carbon-upload" :loading="avatarBusy" :disabled="!avatarFile" @click="uploadAvatar">
                上传头像
              </TxButton>
              <TxButton v-if="avatarFile" variant="secondary" icon="i-carbon-close" :disabled="avatarBusy" @click="discardAvatar">
                不用这张
              </TxButton>
              <TxButton variant="secondary" icon="i-carbon-logo-github" :disabled="!uploadedAvatar || avatarBusy" @click="resetAvatar">
                恢复 GitHub 头像
              </TxButton>
            </TxFlex>
          </TxStack>

          <TxStack v-else :gap="16">
            <TxFlex align="center" :gap="12">
              <UserAvatar v-if="preview" :user="preview" size="xlarge" />
              <TxStack :gap="4">
                <span class="font-medium">头像预览</span>
                <span class="text-sm text-$tx-text-color-secondary">头像由昵称的首字母和下面选中的颜色组成。</span>
              </TxStack>
            </TxFlex>

            <TxRadioGroup v-model="draft.avatarColor" type="card" direction="row">
              <TxRadio
                v-for="color in AVATAR_PALETTE"
                :key="color"
                :value="color"
                :label="`头像颜色 ${color}`"
              >
                <TxAvatar
                  :name="draft.displayName || profile.displayName"
                  :background-color="color"
                  size="medium"
                  :alt="`头像颜色 ${color}`"
                />
              </TxRadio>
            </TxRadioGroup>
          </TxStack>
        </TxTabItem>

        <TxTabItem name="notifications" icon-class="i-carbon-notification">
          <template #name>
            通知
          </template>

          <TxGroupBlock name="通知" description="关掉之后，对应的事件不会再给你发通知。" :collapsible="false">
            <TxBlockSwitch
              v-model="draft.notifyPrefs.reply"
              title="有人回复我"
              description="别人回复你的话题或帖子时通知你"
            />
            <TxBlockSwitch
              v-model="draft.notifyPrefs.like"
              title="有人赞我"
              description="别人赞你的帖子时通知你"
            />
            <TxBlockSwitch
              v-model="draft.notifyPrefs.follow"
              title="有人关注我"
              description="别人关注你时通知你"
            />
          </TxGroupBlock>
        </TxTabItem>

        <TxTabItem name="interface" icon-class="i-carbon-color-palette">
          <template #name>
            界面
          </template>

          <TxGroupBlock name="界面" description="只影响这台设备上的浏览器。" :collapsible="false">
            <TxBlockSelect
              :model-value="colorMode.preference"
              title="主题"
              description="立即生效，不需要保存"
              @update:model-value="setTheme"
            >
              <TxSelectItem value="system" label="跟随系统" icon="i-carbon-screen" />
              <TxSelectItem value="light" label="浅色" icon="i-carbon-sun" />
              <TxSelectItem value="dark" label="深色" icon="i-carbon-moon" />
            </TxBlockSelect>
          </TxGroupBlock>
        </TxTabItem>
      </TxTabs>
    </TxCard>

    <TxFlex justify="flex-end" :gap="8">
      <TxButton variant="secondary" @click="revert">
        放弃修改
      </TxButton>
      <TxButton variant="primary" icon="i-carbon-checkmark" :loading="saving" @click="save">
        保存更改
      </TxButton>
    </TxFlex>
  </TxStack>
</template>
