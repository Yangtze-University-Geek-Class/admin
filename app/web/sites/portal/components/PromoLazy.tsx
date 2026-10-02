// 宣传片播放层按需加载。分包加载失败（断网、发版后旧页面找不到新文件名）时当作「播放失败」直接结束，
// 不让整个官网跟着卸载：宣传片不挡报名。
// 失败只算这一次打开（#110）：React.lazy 会一直记住第一次加载的结果，所以失败过的那个，下次打开时换一个新的；
// 浏览器也记着加载失败的分包地址，所以重来时由 retryableImport 换成写死的 ?retry=n 地址重新加载。
// 播放层样式放在这里（跟官网主包走），不跟播放层分包：Vite 的分包预加载把失败过的样式表记为已加载、不再重试，
// 断网失败过一次以后，换地址加载回来的播放层会没有样式。
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ComponentType, type KeyboardEvent, type LazyExoticComponent } from "react";
import { retryableImport } from "../lib/promo";
import type PromoPlayer from "./PromoPlayer";
import type { PromoEnd } from "./PromoPlayer";
import Icon from "./Icon";
import "../styles/promo.css";

type PlayerProps = ComponentProps<typeof PromoPlayer>;
type Props = Omit<PlayerProps, "coverSince">;

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
/** failed：这个分包加载失败过。不管有没有人看到这次失败（加载中就点了跳过时没人看到），下次打开都换新的 */
type Loaded = { Player: LazyExoticComponent<ComponentType<PlayerProps>>; failed: boolean };
const loadPlayer = (): Loaded => {
  const loaded: Loaded = {
    failed: false,
    Player: lazy(() =>
      importPlayer().catch(() => {
        loaded.failed = true;
        return { default: PromoUnavailable };
      }),
    ),
  };
  return loaded;
};
let current = loadPlayer();

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

/**
 * 打开一次宣传片。分包在这里自己挂起（Suspense 在本组件里面），所以本组件的状态在等分包的整段时间里都在：
 * 每次打开记住当时那个播放层，打开期间父组件重渲染，不会换成新的再加载一遍。
 * placeholder：分包没到时先显示加载遮罩（gate 用，#122）；不传时这段时间什么都不显示。
 */
export function LazyPromoPlayer({ placeholder = false, ...props }: Props & { placeholder?: boolean }) {
  // 打开时定一次：上次的分包失败过就换一个新的（retryableImport 换地址重新加载）。只在这里换：
  // 本组件在 Suspense 外面，挂起后重试的那次渲染不会再走这里，同一次打开不会加载两遍
  const [Player] = useState(() => {
    if (current.failed) current = loadPlayer();
    return current.Player;
  });
  // 加载遮罩画出来的时刻：播放层顶替它时从这里接着淡入，不从透明重来
  const [coverSince, setCoverSince] = useState<number>();
  return (
    <Suspense fallback={placeholder ? <PromoFallback {...props} onShown={setCoverSince} /> : null}>
      <Player {...props} coverSince={coverSince} />
    </Suspense>
  );
}

/**
 * 播放层分包还在下载时的加载遮罩（#122）：直接打开 /join-us 的第一次访问会被整页 inert，
 * 弱网下分包要几秒才到，这段时间不能什么都不显示。遮罩沿用播放层同一套全屏层与右上角「跳过」，
 * 跳过与播放层同一语义：先记「看过」，再结束 gate；Esc 同样能关，Tab 留在按钮上。
 * replay 也能用（按钮叫「关闭」、图标与播放层一致），目前桌面重看不带 placeholder。
 * 分包到了以后 React 删掉遮罩、挂上真正的播放层（两个是不同的节点）：播放层拿到 onShown 记下的时刻，
 * 接着遮罩的淡入走（promo.css 的 pt-promo-in），不会从透明重来、透出下面的浅色页面。
 */
function PromoFallback({ mode, onSeen, onClose, onShown }: Props & { onShown: (at: number) => void }) {
  const skip = useRef<HTMLButtonElement>(null);
  // 在浏览器画出这一帧之前记下：遮罩的淡入动画从这一帧开始
  useLayoutEffect(() => {
    onShown(performance.now());
  }, [onShown]);
  useEffect(() => {
    // 打开时把焦点放在「跳过」上：键盘和读屏一进来就能操作，Esc 也落在遮罩内
    skip.current?.focus({ preventScroll: true });
  }, []);
  const close = (reason: PromoEnd) => {
    onSeen?.();
    onClose(reason);
  };
  // 和播放层的键盘规则一致（PromoPlayer 的 onKeyDown）
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close("skipped");
    } else if (event.key === "Tab") {
      // 遮罩上只有这一个按钮：焦点留在它身上，不跑到浏览器界面
      event.preventDefault();
      skip.current?.focus();
    }
  };
  const closeLabel = mode === "gate" ? "跳过" : "关闭";
  return (
    <div className="pt-root pt-promo" role="dialog" aria-modal="true" aria-label="极客班宣传片" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="pt-promo-frame">
        <div className="pt-promo-stage">
          <button ref={skip} type="button" className="pt-promo-chip pt-promo-close" onClick={() => close("skipped")}>
            <Icon name={mode === "gate" ? "skip-forward-line" : "close-line"} size={16} />
            {closeLabel}
            <kbd>Esc</kbd>
          </button>
          <p className="pt-promo-status" role="status">
            <Icon name="loader-4-line" size={18} className="pt-spin" />
            正在加载…
          </p>
        </div>
      </div>
    </div>
  );
}
