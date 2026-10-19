/** 将显示尺寸中的指针位置转换到缩略图的逻辑画布，再映射到世界坐标。 */
export function minimapClientToWorld(point, rect, geometry) {
  if (rect.width <= 0 || rect.height <= 0 || geometry.scale <= 0) throw new Error("缩略图尺寸或缩放无效");
  return {
    x: ((point.x - rect.left) * geometry.width / rect.width - geometry.offsetX) / geometry.scale,
    y: ((point.y - rect.top) * geometry.height / rect.height - geometry.offsetY) / geometry.scale,
  };
}
