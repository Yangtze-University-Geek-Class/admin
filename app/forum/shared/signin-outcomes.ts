/**
 * 登录没成功时，核心服务回到原页面并带上 `?signin=<原因>`（见 app/server/src/routes/admin/auth.ts），
 * 论坛顶栏按这里的文案提示一次。论坛里一篇帖子都没有时（极客班论坛没有公开任何旧帖），不说「不登录也能看帖子」。
 */
export interface SigninOutcome { title: string, description: string, variant: 'info' | 'warning' }

export function signinOutcomes(options: { hasPosts: boolean }): Record<string, SigninOutcome> {
  return {
    not_member: {
      title: '只有极客班成员可以登录',
      description: options.hasPosts ? '这个 GitHub 账号不在极客班的 GitHub 组织里。不登录也能看帖子。' : '这个 GitHub 账号不在极客班的 GitHub 组织里。',
      variant: 'warning',
    },
    invite_pending: { title: '还没接受组织邀请', description: '到 GitHub 的通知或邮件里接受极客班组织的邀请，再回来登录。', variant: 'warning' },
    cancelled: { title: '已取消登录', description: '需要时再点右上角的登录。', variant: 'info' },
    failed: { title: '登录没有完成', description: '请稍后再试一次。', variant: 'warning' },
  }
}
