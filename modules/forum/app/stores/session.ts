import type { User } from '~/data/types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isStaff as isStaffUser } from '~/data/permissions'
import { DEFAULT_SESSION } from '~/data/seed'
import { useForumStore } from './forum'

/**
 * Who is "logged in". Mock auth: any seeded user can be picked from a list,
 * and `null` is the guest state that hides every write control.
 */
export const useSessionStore = defineStore('session', () => {
  const currentUserId = ref<string | null>(DEFAULT_SESSION.currentUserId)

  const forum = useForumStore()

  /** `null` for guests and for a stale id that no longer resolves (e.g. after a reset to a different seed). */
  const currentUser = computed<User | null>(() =>
    currentUserId.value ? forum.userById(currentUserId.value) ?? null : null,
  )
  const isLoggedIn = computed(() => currentUser.value !== null)
  const isStaff = computed(() => isStaffUser(currentUser.value))

  function login(userId: string): boolean {
    if (!forum.userById(userId))
      return false
    currentUserId.value = userId
    return true
  }

  function logout(): void {
    currentUserId.value = null
  }

  return { currentUserId, currentUser, isLoggedIn, isStaff, login, logout }
})
