# 极客娘壁纸素材

桌面原图 `yugc.webp`（坐在粉色面板上挥手）与 `geek.webp`（举手跳起）保持不变。#206 的手机版以对应原图作为人物与画风参考，通过内置 `image_gen` 分别重新构图生成，不是横图裁切或 CSS 放大。

## 发布物料

| 文件 | 尺寸 | 字节 | SHA-256 |
|---|---|---|---|
| `yugc-phone.webp` | 900×1950 | 80310 | `157a24830f538b79f1ee137f1607154e8f46a0eba98ae71066c56dbf8857bd01` |
| `yugc-phone-thumb.webp` | 180×390 | 6416 | `3c7e51c74d107f077f4cdbe7b2c4e23d5cc6a9666f23897b875589c841d360ab` |
| `geek-phone.webp` | 900×1950 | 124828 | `c6c2092c79a2e2771d2299e62857b2552213310b6f805553c985d8019fe21666` |
| `geek-phone-thumb.webp` | 180×390 | 8588 | `598a9442961ce026e41d2643caca0378cd6dcc99aed67793217e8a756b0d880e` |

生成结果为竖屏 PNG（坐姿831×1893，跳跃853×1844）；用已有 `sharp` 等比适配至900×1950，仅收去少量外缘，不拉伸或裁断人物。WebP 主图质量84、effort6，缩略图180×390、质量78、effort6。PNG 不随站点发布；清单由 `lib/wallpapers.ts` import，构建加内容哈希，与既有 CDN 开关同行。

上半屏留出应用区，下半屏保留人物与对应姿态，移除桌面大字；没有把 UI 按钮画进壁纸。手机竖屏使用手机版，横屏使用宽版，仍共用 `yugc` / `geek` 两个选择 ID。

## 最终提示词

以下是两个入选版本的实际提示词。首个坐姿候选未入选，不覆盖桌面原图。

### 极客娘 1

参考输入：`yugc.webp`。

```text
Use case: identity-preserve. Asset type: production mobile wallpaper, full bleed, opaque, very tall 9:19.5 portrait image (1080x2340). Input image: preserve the reference YUGC mascot identity and anime drawing style. Recompose and redraw independently, do not crop the landscape. IMPORTANT: upper 52 percent of canvas is only pale sky-blue gradient with tiny subtle hearts and hexagonal outlines. No character or foreground there. Small complete mascot sits on a candy-pink floating window panel in the lower half, her hair starts at 53 percent of canvas height, face near 61 percent, shoes end at 88 percent. Leave clear blue along bottom 10 percent. Keep navy bob haircut and ahoge, blue eyes, hexagonal hair clips plus snowflake clip, friendly open-hand wave, white-and-blue circuit sailor jacket, navy skirt, blue-and-white socks and sneakers, seated pose, complete anatomy including both shoes. Pink panel supports her, soft pastel pink/mint hearts around lower edges only. Match reference's polished crisp anime illustration. No YUGC letters, no text or logos, no phone mockup, no UI screenshot, no generated buttons or status bars, no watermark. Prioritize tall smartphone canvas and clear TOP HALF for real app icons over making a large character portrait.
```

### 极客娘 2

参考输入：`geek.webp`。

```text
Use case: identity-preserve. Asset type: real production portrait wallpaper for a smartphone, not a mockup, no rendered phone frame. Input image: character identity and style reference from the current GEEK landscape wallpaper. Independently redraw and recompose as a very tall 9:19.5 full-bleed portrait canvas, target 1080x2340. Preserve exactly the friendly anime mascot: navy blue bob haircut with single ahoge, blue eyes, two hexagonal clips and white snowflake clip, circuit-pattern white and blue sailor jacket, navy skirt, blue-and-white sneakers. Same energetic jumping/waving pose and anime linework as reference. Composition requirement: the TOP HALF of the entire canvas must be empty, low-contrast sky-blue gradient with faint heart and hexagonal pattern ONLY. Start the character's hair at 52 percent of canvas height, her face at 61 percent; scale the complete jumping character to fit from 52 percent to 88 percent with all limbs and shoes inside the canvas. This is a much smaller full-body character below the icon area, not a huge cropped face. Sparse pink hearts, tiny blue cubes, small blue-and-white headphones and laptop float near lower outer edges, arranged naturally in the lower half only. Bottom 10 percent is clear blue for a real Dock overlay. Remove all giant GEEK lettering and all large desktop window frames. Keep pastel sky-blue, white, cobalt and candy-pink identity. No text or typography, no logos, no generated app icons, no status bar, no buttons, no watermark. Do not crop/stretch the landscape reference. Opaque background.
```

提示词尺寸与位置是生成意图，不冒充模型逐像素遵循；发布尺寸以上表和解码测试为准，人物遮挡以真实主屏截图检查。
