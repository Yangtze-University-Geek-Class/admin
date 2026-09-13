import type { UserRole } from '~/data/types'

export function roleLabel(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '管理员'
    case 'moderator':
      return '版主'
    default:
      return '成员'
  }
}

/** `TxStatusBadge` tone for a role chip. */
export function roleTone(role: UserRole): 'info' | 'warning' | 'muted' {
  switch (role) {
    case 'admin':
      return 'info'
    case 'moderator':
      return 'warning'
    default:
      return 'muted'
  }
}
