<script setup lang="ts">
import { toast } from '@talex-touch/tuffex/utils'
import { AVATAR_PALETTE } from '~/data/seed-content'

// Discourse's /u/<name>/preferences: a left-hand sub-navigation over the form.
// Only your own; somebody else's redirects back to their profile.
definePageMeta({
  key: route => route.path,
})

const route = useRoute()
const router = useRouter()
const forum = useForumStore()
const { user: viewer, isLoggedIn, can } = useCurrentUser()
const { loginOpen } = useShell()
const { isSnapshot } = useContentSource()
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

/** A live user object for the avatar previews, without touching the store. */
const preview = computed(() => (profile.value ? { ...profile.value, displayName: draft.displayName || profile.value.displayName, avatarColor: draft.avatarColor } : undefined))

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

function save() {
  const current = profile.value
  if (!current || !isSelf.value)
    return
  forum.updateProfile(current.id, {
    displayName: draft.displayName.trim() || current.displayName,
    bio: draft.bio.trim(),
    location: draft.location.trim(),
    website: draft.website.trim(),
    avatarColor: draft.avatarColor,
    notifyPrefs: { ...draft.notifyPrefs },
  })
  toast({ title: '偏好设置已保存', variant: 'success' })
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
    <TxEmptyState
      variant="permission"
      :title="isSnapshot ? '资料修改还没开放' : '登录后才能修改偏好设置'"
      :description="isSnapshot ? '资料修改正在接入，接好后用官网的 GitHub 登录就能用。' : '偏好设置属于某个身份，先选一个再回来。'"
      :primary-action="isSnapshot ? undefined : { label: '登录', variant: 'primary' }"
      @primary="loginOpen = true"
    />
  </TxCard>

  <TxStack v-else-if="profile && isSelf" :gap="16">
    <TxFlex align="center" :gap="8" wrap="wrap">
      <h1 class="text-xl font-semibold">
        偏好设置
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
              title="显示名"
              description="列表和帖子里显示的名字"
              placeholder="你的显示名"
              clearable
            />
            <TxBlockInput
              v-model="draft.bio"
              title="简介"
              description="一句话介绍自己"
              placeholder="比如：在做 CoreBox 的搜索"
              clearable
            />
            <TxBlockInput
              v-model="draft.location"
              title="所在地"
              description="可选"
              placeholder="比如：杭州"
              clearable
            />
            <TxBlockInput
              v-model="draft.website"
              title="网站"
              description="可选，会作为链接显示"
              placeholder="https://example.com"
              clearable
            />
          </TxGroupBlock>
        </TxTabItem>

        <TxTabItem name="avatar" icon-class="i-carbon-user-avatar">
          <template #name>
            头像
          </template>

          <TxStack :gap="16">
            <TxFlex align="center" :gap="12">
              <UserAvatar v-if="preview" :user="preview" size="xlarge" />
              <TxStack :gap="4">
                <span class="font-medium">头像预览</span>
                <span class="text-sm text-$tx-text-color-secondary">头像由显示名的首字母和下面选中的颜色组成。</span>
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
      <TxButton variant="primary" icon="i-carbon-checkmark" @click="save">
        保存更改
      </TxButton>
    </TxFlex>
  </TxStack>
</template>
