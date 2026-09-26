<script setup lang="ts">
import type { TurnstileApi } from '../../shared/turnstile'
import { loadTurnstile } from '../../shared/turnstile'

// The Turnstile check under a guest reply, rendered only when the server asks
// for one (`guestPolicy.turnstileSiteKey`). The token is single-use: the
// composer bumps `round` after every send, which renders a fresh widget and
// clears the token until it is solved again.
const props = defineProps<{ siteKey: string, round: number }>()

const token = defineModel<string>('token', { required: true })

const box = ref<HTMLElement | null>(null)
const error = ref('')
const retries = ref(0)

let api: TurnstileApi | undefined
let widget: string | undefined

function clear() {
  if (widget !== undefined)
    api?.remove(widget)
  widget = undefined
}

watch(() => [props.siteKey, props.round, retries.value, box.value] as const, (_next, _previous, onCleanup) => {
  let cancelled = false
  onCleanup(() => {
    cancelled = true
    clear()
  })
  token.value = ''
  error.value = ''
  if (!box.value)
    return
  loadTurnstile().then((loaded) => {
    if (cancelled || !box.value)
      return
    api = loaded
    widget = loaded.render(box.value, {
      'sitekey': props.siteKey,
      'theme': 'auto',
      'callback': (value: string) => {
        token.value = value
      },
      'expired-callback': () => {
        token.value = ''
      },
      'error-callback': () => {
        token.value = ''
        error.value = '人机验证没有通过'
      },
    })
  }).catch((cause: unknown) => {
    if (!cancelled)
      error.value = cause instanceof Error ? cause.message : '人机验证没有加载出来'
  })
}, { immediate: true, flush: 'post' })

onBeforeUnmount(clear)
</script>

<template>
  <TxStack :gap="8">
    <div ref="box" />
    <TxFlex v-if="error" align="center" :gap="8" wrap="wrap" role="alert">
      <span class="text-sm text-$tx-color-danger">{{ error }}，回复前要先完成这一步。</span>
      <TxButton variant="secondary" size="sm" icon="i-carbon-renew" @click="retries += 1">
        重试
      </TxButton>
    </TxFlex>
  </TxStack>
</template>
