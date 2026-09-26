// 宣传片播放层按需加载。分包加载失败（断网、发版后旧页面找不到新文件名）时当作「播放失败」直接结束，
// 不让整个官网跟着卸载：宣传片不挡报名。
// 失败只算这一次打开（#110）：React.lazy 会一直记住第一次加载的结果，所以失败的那个用过就换一个新的；
// 浏览器也记着加载失败的分包地址，所以重来时由 retryableImport 换成写死的 ?retry=n 地址重新加载。
// 播放层样式放在这里（跟官网主包走），不跟播放层分包：Vite 的分包预加载把失败过的样式表记为已加载、不再重试，
// 断网失败过一次以后，换地址加载回来的播放层会没有样式。
import { lazy, useEffect, useRef, useState, type ComponentProps } from "react";
import { retryableImport } from "../lib/promo";
import type PromoPlayer from "./PromoPlayer";
import "../styles/promo.css";

type Props = ComponentProps<typeof PromoPlayer>;

// 换地址的那几个以生产构建为准：开发服务器下 .tsx 带查询参数加载可能报 React 刷新的 preamble 错误
const importPlayer = retryableImport([
  () => import("./PromoPlayer"),
  // @ts-expect-error 同一模块，只为换地址
  () => import("./PromoPlayer?retry=1"),
  // @ts-expect-error 同上
  () => import("./PromoPlayer?retry=2"),
  // @ts-expect-error 同上
  () => import("./PromoPlayer?retry=3"),
]);
const loadPlayer = () => lazy(() => importPlayer().catch(() => ({ default: PromoUnavailable })));
let current = loadPlayer();

/** 只结束一次：父组件传的 onClose 每次渲染都是新函数，不能靠依赖数组防重复 */
function PromoUnavailable({ onClose }: Props) {
  const closed = useRef(false);
  useEffect(() => {
    if (closed.current) return;
    closed.current = true;
    // 失败真正显示出来以后才换：换早了，挂起后重试的那次渲染会拿到新的，又去加载一遍
    current = loadPlayer();
    onClose("failed");
  }, [onClose]);
  return <></>;
}

/** 每次打开时记住当时那个：打开期间父组件重渲染，不会换成新的再加载一遍 */
export function LazyPromoPlayer(props: Props) {
  const [Player] = useState(() => current);
  return <Player {...props} />;
}
