// 比赛窗口里的头像（#239）：有 https 头像就用图片，没有或加载失败显示首字母（底色按用户名算，同一个人每次一样）。
// 外圈颜色区分领队（金色，可加皇冠）与队员；空位是虚线圈。读屏不念头像，名字在旁边的文字里。
import { useState } from "react";
import Icon from "../../Icon";
import type { IconName } from "../../../lib/icons";
import type { Person } from "../../../lib/competitionHub";

type Props = {
  person: Person | null;
  size?: number;
  ring?: "leader" | "member" | "none";
  crown?: boolean;
  /** 空位里的图标：能点的空位用加号，只是占位用人形。 */
  icon?: IconName;
};

function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash % 360;
}

export default function Avatar({ person, size = 40, ring = "none", crown = false, icon = "add-line" }: Props) {
  const [broken, setBroken] = useState(false);
  const style = { ["--s" as string]: `${size}px`, ["--ah" as string]: String(person ? hueOf(person.login) : 230) };
  if (!person) {
    return (
      <span className="pt-cx-ava is-empty" style={style} aria-hidden="true">
        <Icon name={icon} size={Math.round(size * 0.42)} />
      </span>
    );
  }
  const initial = [...person.login][0]?.toUpperCase() ?? "?";
  return (
    <span className={`pt-cx-ava is-${ring}`} style={style} aria-hidden="true">
      {person.avatar_url && !broken ? (
        <img src={person.avatar_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        initial
      )}
      {crown && (
        <span className="pt-cx-crown">
          <Icon name="vip-crown-2-line" size={12} />
        </span>
      )}
    </span>
  );
}

/** 队伍的头像：队伍没有图，用图标。 */
export function TeamBadge({ size = 36 }: { size?: number }) {
  return (
    <span className="pt-cx-ava is-team" style={{ ["--s" as string]: `${size}px` }} aria-hidden="true">
      <Icon name="team-line" size={Math.round(size * 0.46)} />
    </span>
  );
}
