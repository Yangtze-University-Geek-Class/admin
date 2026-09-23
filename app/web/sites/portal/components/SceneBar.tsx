// 三个 3D 场景页（加入我们 / 论坛 / GitHub）共用的顶栏：回到桌面、路径面包屑、品牌。
// 「回到桌面」带着路由 state 回首页，直接落在 YUGC OS 桌面而不是重新从书桌开始。
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import { RESUME_DESKTOP } from "../lib/links";
import Icon from "./Icon";

export default function SceneBar({ crumb }: { crumb: string }) {
  const { brand } = appConfig.portal;
  return (
    <div className="pt-scenebar">
      <Link className="pt-back" to="/" state={RESUME_DESKTOP}>
        <Icon name="arrow-left-line" size={15} /> 回到桌面
      </Link>
      <span className="pt-crumb">
        ~/yugc/<b>{crumb}</b>
      </span>
      <span className="pt-spacer" />
      <Link className="pt-scenebrand" to="/" aria-label={`${brand.title}首页`}>
        <img src={brand.logo} alt="" width={26} height={26} />
        <span>{brand.title}</span>
      </Link>
    </div>
  );
}
