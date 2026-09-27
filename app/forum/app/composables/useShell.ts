const SIDEBAR_KEY = 'tuff-forum:sidebar'

/**
 * Open/closed state of the app shell, shared between the header (which owns
 * the buttons), the layout (which owns the panels) and `app.vue` (which owns
 * the command palette). `useState` keeps every caller on the same refs.
 *
 * Desktop (≥1024px) shows the sidebar as a column and remembers whether it
 * is collapsed; narrower viewports move it into a drawer that never persists.
 */
export function useShell() {
  // `useMediaQuery` reports `false` until the caller mounts; seeding it with
  // the real width gives the first render the right layout instead of a
  // mobile-then-desktop flash.
  const isDesktop = useMediaQuery('(min-width: 1024px)', {
    ssrWidth: import.meta.client ? window.innerWidth : undefined,
  })

  const sidebarOpen = useState<boolean>('shell:sidebar-open', readSidebarPreference)
  const drawerOpen = useState<boolean>('shell:drawer-open', () => false)
  const loginOpen = useState<boolean>('shell:login-open', () => false)
  const paletteOpen = useState<boolean>('shell:palette-open', () => false)
  /** The reply drawer (ReplyComposer) is open; `app.vue` shows toasts at the top meanwhile. */
  const composerOpen = useState<boolean>('shell:composer-open', () => false)

  function toggleSidebar(): void {
    if (isDesktop.value) {
      sidebarOpen.value = !sidebarOpen.value
      writeSidebarPreference(sidebarOpen.value)
    }
    else {
      drawerOpen.value = !drawerOpen.value
    }
  }

  return { isDesktop, sidebarOpen, drawerOpen, loginOpen, paletteOpen, composerOpen, toggleSidebar }
}

function readSidebarPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_KEY) !== 'false'
  }
  catch {
    return true
  }
}

function writeSidebarPreference(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(SIDEBAR_KEY, String(open))
  }
  catch {
    // Storage disabled: the choice still holds for this session.
  }
}
