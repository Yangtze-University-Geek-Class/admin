import type { SiteAccount } from '../shared/site-account'
import type { SigninLapse } from '~/stores/forum-server'
import { describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import * as access from '~/data/access'
import { loadComponent, mount } from './support/sfc'
import { TUFFEX_STUBS } from './support/tuffex-stubs'

/**
 * #164 in the component: once the forum server has ended the sign-in, the
 * account menu turns back into the 登录 button and one toast says so, with the
 * site-wide sign-in as its action. The store side is tests/forum-server-store.test.ts.
 */
const NONE: SigninLapse = { count: 0, ended: false, failed: null, message: null }

/** `stillSignedIn` is what `/auth/me` answers when LoginModal asks it again. */
function setup(lapse: SigninLapse = NONE, stillSignedIn = false) {
  const toast = vi.fn()
  const signIn = vi.fn()
  const account = ref<SiteAccount | null>({ login: 'ada', avatarUrl: null, consoleLink: false })
  const refresh = vi.fn(async () => {
    account.value = stillSignedIn ? { login: 'ada', avatarUrl: null, consoleLink: false } : null
  })
  const server = reactive({ signinLapse: lapse })
  const states = new Map<string, Ref<unknown>>()
  const LoginModal = loadComponent('components/LoginModal.vue', {
    imports: { '@talex-touch/tuffex/utils': { toast }, '~/data/access': access },
    globals: {
      useShell: () => ({ loginOpen: ref(false) }),
      useContentSource: () => ({ siteLogin: true, serverMode: true }),
      useState: <T>(key: string, init: () => T) => {
        if (!states.has(key))
          states.set(key, ref(init()))
        return states.get(key) as Ref<T>
      },
      useCurrentUser: () => ({ access: ref(access.forumAccess('server', 'ready', null)) }),
      useSiteAccount: () => ({ account, refresh }),
      useSiteLinks: () => ({ signIn }),
      useForumStore: () => ({ state: { users: [] } }),
      useSessionStore: () => ({ login: () => false }),
      useForumServerStore: () => server,
    },
  })
  const stub = defineComponent({ setup: () => () => h('div') })
  const mountModal = () => mount(LoginModal, {}, { ...TUFFEX_STUBS, TxModal: stub, TxCardItem: stub, TxStatusBadge: stub, UserAvatar: stub })
  const mounted = mountModal()
  return { toast, signIn, account, refresh, server, mounted, mountModal }
}

describe('LoginModal when the server ends the sign-in (#164)', () => {
  it('signs the account menu out and says so once, with a 登录 action', async () => {
    const { toast, signIn, account, refresh, server } = setup()
    server.signinLapse = { count: 1, ended: true, failed: '没有加上书签', message: '登录已失效，请重新登录' }
    await nextTick()
    expect(account.value).toBeNull()
    // The server said it ended the sign-in: nothing to ask /auth/me.
    expect(refresh).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledTimes(1)
    const shown = toast.mock.calls[0]![0] as { id: string, title: string, description: string, action: { label: string, onClick: () => void } }
    expect(shown).toMatchObject({ id: 'forum-signin-lapsed', title: '没有加上书签', description: '登录已失效，请重新用 GitHub 登录。不登录也能看帖和回复。', variant: 'warning' })
    expect(shown).not.toHaveProperty('signIn')
    expect(shown.action.label).toBe('登录')
    shown.action.onClick()
    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it('says it on mounting when the first read of the state already found the sign-in ended, and only once', async () => {
    const { toast, account, mounted, mountModal } = setup({ count: 1, ended: true, failed: null, message: null })
    expect(account.value).toBeNull()
    expect(toast.mock.calls.map(call => [call[0].id, call[0].title])).toEqual([['forum-signin-lapsed', '登录已失效']])
    mounted.unmount()
    mountModal()
    await nextTick()
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('says it again, under the same toast id, the next time', async () => {
    const { toast, server } = setup()
    server.signinLapse = { count: 1, ended: true, failed: null, message: null }
    await nextTick()
    server.signinLapse = { count: 2, ended: true, failed: null, message: null }
    await nextTick()
    expect(toast.mock.calls.map(call => [call[0].id, call[0].title])).toEqual([['forum-signin-lapsed', '登录已失效'], ['forum-signin-lapsed', '登录已失效']])
  })

  it('asks /auth/me after a plain 401 and says the sign-in is gone when it is (the session ended in another tab)', async () => {
    const { toast, account, refresh, server } = setup()
    server.signinLapse = { count: 1, ended: false, failed: '没有赞上', message: '登录后才能操作' }
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(account.value).toBeNull()
    expect(toast.mock.calls[0]![0]).toMatchObject({ id: 'forum-signin-lapsed', title: '没有赞上', description: '登录已失效，请重新用 GitHub 登录。不登录也能看帖和回复。', action: { label: '登录' } })
  })

  it('says the failure as it was when /auth/me still has the person signed in (taken out of the organisation)', async () => {
    const { toast, account, server } = setup(NONE, true)
    server.signinLapse = { count: 1, ended: false, failed: '没有赞上', message: '登录后才能操作' }
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(account.value).toEqual({ login: 'ada', avatarUrl: null, consoleLink: false })
    expect(toast.mock.calls[0]![0]).toEqual({ title: '没有赞上', description: '登录后才能操作', variant: 'warning' })
  })
})
