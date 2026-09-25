// 宣传片播放层按需加载。分包加载失败（断网、发版后旧页面找不到新文件名）时当作「播放失败」直接结束，
// 不让整个官网跟着卸载：宣传片不挡报名。
import { lazy, useEffect, type ComponentProps } from "react";
import type PromoPlayer from "./PromoPlayer";

type Props = ComponentProps<typeof PromoPlayer>;

function PromoUnavailable({ onClose }: Props) {
  useEffect(() => onClose("failed"), [onClose]);
  return <></>;
}

export const LazyPromoPlayer = lazy(() => import("./PromoPlayer").catch(() => ({ default: PromoUnavailable })));
