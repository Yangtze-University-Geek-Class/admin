<script setup lang="ts">
import { UNAVAILABLE_COPY } from '~/data/access'

// What /bookmarks, /notifications and /u/<name>/preferences show to someone
// without a forum user. The demo asks to pick an identity (upstream copy, as
// before); 极客班论坛 offers the site-wide GitHub sign-in, or says the service
// is down; the read-only snapshot says it is not open yet.
const props = defineProps<{ page: 'bookmarks' | 'notifications' | 'preferences' }>()

const COPY = {
  bookmarks: { demo: '登录后才能查看书签', demoHint: '书签属于某个身份，先选一个再回来。', signIn: '登录后才能查看书签', notOpen: '书签还没开放', notOpenHint: '书签正在接入。' },
  notifications: { demo: '登录后才能查看通知', demoHint: '通知属于某个身份，先选一个再回来。', signIn: '登录后才能查看通知', notOpen: '通知还没开放', notOpenHint: '通知正在接入。' },
  preferences: { demo: '登录后才能修改偏好设置', demoHint: '偏好设置属于某个身份，先选一个再回来。', signIn: '登录后才能修改资料', notOpen: '资料修改还没开放', notOpenHint: '资料修改正在接入。' },
} as const

const { access } = useCurrentUser()
const { loginOpen } = useShell()
const { signIn } = useSiteLinks()

const state = computed(() => {
  const copy = COPY[props.page]
  switch (access.value.loginPrompt) {
    case 'pick-identity':
      return { title: copy.demo, description: copy.demoHint, action: { label: '登录', variant: 'primary' as const } }
    case 'sign-in':
      return { title: copy.signIn, description: '只有极客班成员能用 GitHub 登录。', action: { label: '用 GitHub 登录', variant: 'primary' as const, icon: 'i-carbon-logo-github' } }
    case 'offline':
    case 'busy':
    case 'not-member':
      return { ...UNAVAILABLE_COPY[access.value.loginPrompt], action: undefined }
    default:
      return { title: copy.notOpen, description: copy.notOpenHint, action: undefined }
  }
})

function onAction() {
  if (access.value.loginPrompt === 'sign-in')
    signIn()
  else
    loginOpen.value = true
}
</script>

<template>
  <TxEmptyState
    variant="permission"
    :title="state.title"
    :description="state.description"
    :primary-action="state.action"
    @primary="onAction"
  />
</template>
