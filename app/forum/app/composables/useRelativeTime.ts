import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

// Module-level: the plugin and locale are process-wide dayjs state, and every
// consumer wants the same Chinese "3 小时前" wording.
dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

/** Chinese relative ("3 小时前") and absolute ("2026年9月11日 20:15") timestamps. */
export function useRelativeTime() {
  function fromNow(timestamp: number): string {
    return dayjs(timestamp).fromNow()
  }

  function formatAbsolute(timestamp: number): string {
    return dayjs(timestamp).format('YYYY年M月D日 HH:mm')
  }

  function formatDate(timestamp: number): string {
    return dayjs(timestamp).format('YYYY年M月D日')
  }

  return { fromNow, formatAbsolute, formatDate }
}
