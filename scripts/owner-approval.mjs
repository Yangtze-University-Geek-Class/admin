// 所有者批准的字段判定：hotfix 窗口、晋升窗口与同构清单的豁免共用这一处口径（#328）。
// 只看字段值，不写报错文案；各脚本按自己的字段名组织报错。
import { createHash } from 'node:crypto';

/** 所有者的字面值：批准署名只认这一个写法。 */
export const OWNER = '所有者';
/** 北京时间的日期，或日期加秒（+08:00 可省）：批准、过期、收尾与登记时间都用这个写法。 */
export const TIME_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\+08:00)?)?$/;
/** 去掉首尾空白后至少 min 个字的字符串。 */
export const text = (value, min = 8) => typeof value === 'string' && value.trim().length >= min;

/**
 * 所有者批准的三项是否合格：署名是字面值「所有者」，批准时间是北京时间，批准摘要至少 8 个字。
 * 字段名由调用方传入（窗口是 approvedBy/approvedAt，豁免是 by/at），这里只看值。
 */
export function validateOwnerApproval({ by, at, approval }) {
  return by === OWNER && TIME_RE.test(at ?? '') && text(approval);
}

/**
 * 迁移前的登记（远端 main 上仍是旧格式）：署名是旧的个人账号名，只存它小写后的 sha256（同隐私门禁的登记表写法），
 * 批准摘要字段叫 quote。只用于读提交里的登记（readRegistryAt 的结果）；工作区与新写入的登记仍用上面的严格判定。
 * 过渡期：main 换成新格式后删掉这一段与 LEGACY_OWNER_SHA256。
 */
export const LEGACY_OWNER_SHA256 = 'c320ed23d8d5e1f97f77948addd777637dc1b327b863ba4b12d8f10a41b5d14c';
export function validateLegacyOwnerApproval({ by, at, approval, quote }) {
  const legacyOwner = typeof by === 'string' && createHash('sha256').update(by.toLowerCase()).digest('hex') === LEGACY_OWNER_SHA256;
  return (by === OWNER || legacyOwner) && TIME_RE.test(at ?? '') && (text(approval) || text(quote));
}
