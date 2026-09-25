// 宣传片播放层按需加载。分包加载失败（断网、发版后旧页面找不到新文件名）时当作「播放失败」直接结束，
// 不让整个官网跟着卸载：宣传片不挡报名。
import { lazy, useEffect, useRef, type ComponentProps } from "react";
import type PromoPlayer from "./PromoPlayer";

type Props = ComponentProps<typeof PromoPlayer>;

/** 只结束一次：父组件传的 onClose 每次渲染都是新函数，不能靠依赖数组防重复 */
function PromoUnavailable({ onClose }: Props) {
  const closed = useRef(false);
  useEffect(() => {
    if (closed.current) return;
    closed.current = true;
    onClose("failed");
  }, [onClose]);
  return <></>;
}

export const LazyPromoPlayer = lazy(() => import("./PromoPlayer").catch(() => ({ default: PromoUnavailable })));
