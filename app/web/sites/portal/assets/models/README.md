# iPhone 15 Pro Max model attribution

- Work: Apple iPhone 15 Pro Max Black.
- Author: polyman / polyman Studio, https://sketchfab.com/Polyman_3D .
- Original: https://sketchfab.com/3d-models/apple-iphone-15-pro-max-black-df17520841214c1792fb8a44c6783ee7 .
- License: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/ .
- License verified: 2026-10-05 against the original model's public API and the GLB's embedded `asset.extras`; both identify the same author, model and CC BY 4.0 license.
- Download mirror: https://raw.githubusercontent.com/sanidhyy/apple-clone/ebc6c621ecec75dd7ded52a8f15a88a0322ea7b3/public/models/scene.glb .
- Source Git blob: `fd7336805104b8ead3fb0524fd0ef0be92ee90b9`.
- Repository asset: `iphone_15_pro_max.glb`, 1,815,512 bytes, 43,719 triangles.
- SHA-256: `b8cfde0222dae5e1cf4951d0586964b8207b68243d8be0c91fb7787c3a3d546d`.

Changes: decoded Draco offline, simplified with a maximum relative error of 0.0001 while locking borders, and quantized vertex attributes. Author/license/source metadata remains embedded. At runtime the model is scaled uniformly and rotated; its authored display geometry receives YUGC OS content and is reused for the transition cover. The original enclosure, glass, buttons, cameras and Dynamic Island are retained. This does not imply endorsement by the author or Apple.

The model is vendored, not fetched from Sketchfab at runtime. Vite imports it as a hashed asset, alongside the portal's other media. `three/phone.ts` uses the pinned node names `xXDHkMplTIDAXLN` (display), `vELORlCJixqPHsZ` (front glass) and `GuYJryuYunhpphO` (frame). Replacing the asset requires checking these nodes and rerunning the phone browser regressions.

Preparation used glTF Transform CLI 4.2.1 with core/functions/extensions 4.5.1. It adds no production dependency or browser Draco decoder. Given the source GLB:

```sh
pnpm dlx @gltf-transform/cli@4.2.1 copy scene.glb decoded.glb
pnpm dlx @gltf-transform/cli@4.2.1 simplify decoded.glb simplified.glb --ratio 0.35 --error 0.0001 --lock-border true
pnpm dlx @gltf-transform/cli@4.2.1 quantize simplified.glb iphone_15_pro_max.glb --quantize-position 16 --quantize-normal 12 --quantize-texcoord 14
```

Do not overwrite the repository asset without comparing the resulting geometry and hash. The public About panel includes source/author and license links plus the modification notice.
