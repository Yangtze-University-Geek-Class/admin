#!/usr/bin/env python3
"""Build the fixed-size image pieces of the #148 mail envelope.

Usage (from the repo root): python3 scripts/mail-envelope/build.py . /tmp/mail-envelope/assets
Needs resvg, pngquant, oxipng on PATH and Pillow for Python; see docs/services/server/mail.md.

Sources (official art shipped by the portal):
  app/web/public/portal/nano-wave-560.webp   the waving mascot on the portal boot screen
  app/web/public/logo.png                    the class emblem (stamp, wax seal)
Colours follow app/web/sites/portal/three/join.ts (ivory envelope, cobalt/amber airmail
stripes, cobalt hexagon liner, cobalt wax seal) and styles/scenes.css (letter paper).

Every piece is exported at 2x of its display size, quantised with pngquant, recompressed
with oxipng and named <name>-<first 8 hex of sha256>.png. MANIFEST.txt and manifest.json
list the files of this run; files from earlier runs in the output directory are left alone.
"""

import base64
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageFilter

REPO = os.path.abspath(sys.argv[1])
OUT = os.path.abspath(sys.argv[2])
WORK = tempfile.mkdtemp(prefix="mail-pieces-")

IVORY = "#fbf8f1"
LINER = "#2c3cb2"
COBALT = "#3346c8"
COBALT_SOFT = "#e6e9fb"
# postmark ink: lighter than COBALT so the rings still read on the dark-mode paper (#1c2140)
POSTMARK = "#5a6ee6"
# airmail stripes from join.ts, flattened over the ivory paper (0.86 cobalt, 0.9 amber)
STRIPE_COBALT = "#4f5fce"
STRIPE_AMBER = "#eea235"

LOGO = os.path.join(REPO, "app/web/public/logo.png")
MASCOT = os.path.join(REPO, "app/web/public/portal/nano-wave-560.webp")


def data_uri(path: str) -> str:
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


def render_svg(svg: str, name: str) -> Image.Image:
    src = os.path.join(WORK, name + ".svg")
    dst = os.path.join(WORK, name + ".png")
    with open(src, "w") as f:
        f.write(svg)
    subprocess.run(["resvg", src, dst], check=True)
    return Image.open(dst).convert("RGBA")


def hex_path(cx: float, cy: float, r: float) -> str:
    pts = []
    for k in range(6):
        a = math.pi / 6 + k * math.pi / 3
        pts.append(f"{cx + math.cos(a) * r:.2f},{cy + math.sin(a) * r:.2f}")
    return "M" + " L".join(pts) + " Z"


def star_path(cx: float, cy: float, r: float) -> str:
    """Four-point sparkle, the same shape the portal uses for small accents."""
    k = r * 0.28
    return (
        f"M{cx},{cy - r} C{cx + k * 0.4},{cy - k} {cx + k},{cy - k * 0.4} {cx + r},{cy} "
        f"C{cx + k},{cy + k * 0.4} {cx + k * 0.4},{cy + k} {cx},{cy + r} "
        f"C{cx - k * 0.4},{cy + k} {cx - k},{cy + k * 0.4} {cx - r},{cy} "
        f"C{cx - k},{cy - k * 0.4} {cx - k * 0.4},{cy - k} {cx},{cy - r} Z"
    )


def liner_pattern(pid: str) -> str:
    r = 9
    dx = r * math.sqrt(3)
    dy = r * 1.5
    cells = []
    for row in range(2):
        y = row * dy
        for col in range(-1, 3):
            x = col * dx + (dx / 2 if row % 2 else 0)
            cells.append(hex_path(x, y, r))
            cells.append(hex_path(x, y + 2 * dy, r))
    return (
        f'<pattern id="{pid}" width="{dx:.3f}" height="{2 * dy:.3f}" patternUnits="userSpaceOnUse">'
        f'<path d="{" ".join(cells)}" fill="none" stroke="rgba(170,184,255,0.26)" stroke-width="1.3"/>'
        "</pattern>"
    )


def airmail_pattern(pid: str, stripe: float, period: float) -> str:
    """Diagonal airmail stripes: cobalt, gap, amber, gap (join.ts draws them at 45 degrees)."""
    return (
        f'<pattern id="{pid}" width="{2 * period}" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
        f'<rect x="0" y="0" width="{stripe}" height="40" fill="{STRIPE_COBALT}"/>'
        f'<rect x="{period}" y="0" width="{stripe}" height="40" fill="{STRIPE_AMBER}"/>'
        "</pattern>"
    )


# ── header: the mascot waving behind the letter, an opened airmail envelope beside her ──
HEADER_W, HEADER_H = 1200, 440


def envelope_svg() -> str:
    w, h = 372, 244
    apex = 118  # depth of the V opening
    flap = 118  # height of the open flap above the body
    pocket = f"M0,0 L{w / 2},{apex} L{w},0 L{w},{h} L0,{h} Z"
    inset, band = 8, 12
    frame = (
        f"M{inset},{inset} H{w - inset} V{h - inset} H{inset} Z "
        f"M{inset + band},{inset + band} V{h - inset - band} H{w - inset - band} V{inset + band} Z"
    )
    cx, cy = 866, 352
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{HEADER_W}" height="{HEADER_H}" viewBox="0 0 {HEADER_W} {HEADER_H}">
<defs>
  {liner_pattern("hex")}
  {airmail_pattern("air", 9, 16)}
  <clipPath id="body"><rect x="0" y="0" width="{w}" height="{h}" rx="12"/></clipPath>
  <clipPath id="pocket"><path d="{pocket}"/></clipPath>
  <radialGradient id="inside" cx="0.5" cy="0.05" r="0.9">
    <stop offset="0" stop-color="#16206e" stop-opacity="0.55"/>
    <stop offset="1" stop-color="#16206e" stop-opacity="0"/>
  </radialGradient>
  <filter id="soft" x="-10%" y="-40%" width="120%" height="180%">
    <feGaussianBlur stdDeviation="7"/>
  </filter>
  <filter id="drop" x="-20%" y="-20%" width="140%" height="160%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="9"/>
    <feOffset dx="0" dy="10" result="b"/>
    <feFlood flood-color="#1b2140" flood-opacity="0.16"/>
    <feComposite in2="b" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<g transform="translate({cx},{cy}) rotate(-7) translate({-w / 2},{-h / 2})" filter="url(#drop)">
  <path d="M8,4 L{w / 2},{-flap} L{w - 8},4 Z" fill="{LINER}" stroke="{IVORY}" stroke-width="8" stroke-linejoin="round"/>
  <path d="M14,2 L{w / 2},{-flap + 12} L{w - 14},2 Z" fill="url(#hex)"/>
  <g clip-path="url(#body)">
    <rect x="0" y="0" width="{w}" height="{h}" fill="{LINER}"/>
    <rect x="0" y="0" width="{w}" height="{h}" fill="url(#hex)"/>
    <rect x="0" y="0" width="{w}" height="{h}" fill="url(#inside)"/>
    <path d="{pocket}" fill="{IVORY}"/>
    <g clip-path="url(#pocket)">
      <path d="M0,{h} L{w / 2},{apex + 18} L{w},{h}" fill="none" stroke="#5a4628" stroke-opacity="0.13" stroke-width="2.4"/>
      <path d="M0,{h} L{w / 2},{apex + 18} L{w},{h} Z" fill="#ffffff" fill-opacity="0.28"/>
      <path d="{frame}" fill="url(#air)" fill-rule="evenodd"/>
      <path d="M0,0 L{w / 2},{apex} L{w},0" fill="none" stroke="#5a4628" stroke-opacity="0.14" stroke-width="22" filter="url(#soft)"/>
    </g>
    <path d="M0,0 L{w / 2},{apex} L{w},0" fill="none" stroke="#5a4628" stroke-opacity="0.18" stroke-width="2"/>
  </g>
  <rect x="1" y="1" width="{w - 2}" height="{h - 2}" rx="12" fill="none" stroke="#1b2140" stroke-opacity="0.10" stroke-width="2"/>
</g>
</svg>"""


def deco_svg() -> str:
    parts = [
        f'<path d="{star_path(118, 74, 20)}" fill="{COBALT}" fill-opacity="0.55"/>',
        f'<path d="{star_path(84, 128, 11)}" fill="#f5a524" fill-opacity="0.85"/>',
        f'<path d="{star_path(1122, 92, 16)}" fill="{COBALT}" fill-opacity="0.45"/>',
        f'<path d="{hex_path(1112, 206, 13)}" fill="none" stroke="{COBALT}" stroke-opacity="0.32" stroke-width="3" stroke-linejoin="round"/>',
    ]
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{HEADER_W}" height="{HEADER_H}">{"".join(parts)}</svg>'


def sticker(img: Image.Image, width: int) -> Image.Image:
    """White sticker outline (keeps the navy hair readable on dark backgrounds)."""
    pad = width + 2
    canvas = Image.new(
        "RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0)
    )
    canvas.alpha_composite(img, (pad, pad))
    alpha = canvas.getchannel("A").point([255 if v > 24 else 0 for v in range(256)])
    grown = alpha.filter(ImageFilter.MaxFilter(2 * width + 1)).filter(
        ImageFilter.GaussianBlur(0.8)
    )
    outline = Image.new("RGBA", canvas.size, (255, 255, 255, 0))
    outline.putalpha(grown)
    outline.alpha_composite(canvas)
    return outline


def build_header() -> Image.Image:
    base = Image.new("RGBA", (HEADER_W, HEADER_H), (0, 0, 0, 0))
    base.alpha_composite(render_svg(deco_svg(), "deco"))
    base.alpha_composite(render_svg(envelope_svg(), "envelope"))

    mascot = Image.open(MASCOT).convert("RGBA")
    scale = 0.8
    mascot = mascot.resize(
        (round(mascot.width * scale), round(mascot.height * scale)),
        Image.Resampling.LANCZOS,
    )
    mascot = sticker(mascot, 5)
    left, top = 170, 8
    layer = Image.new(
        "RGBA", (HEADER_W, max(HEADER_H, top + mascot.height)), (0, 0, 0, 0)
    )
    layer.alpha_composite(mascot, (left, top))
    base.alpha_composite(layer.crop((0, 0, HEADER_W, HEADER_H)))

    # the letter below sits in front: a soft shade on whatever it covers, right at the cut
    shade_h = 22
    ramp = Image.linear_gradient("L").resize(
        (HEADER_W, shade_h)
    )  # 0 at top → 255 at bottom
    shade_alpha = ramp.point([round(v * 0.16) for v in range(256)])
    covered = base.getchannel("A").crop((0, HEADER_H - shade_h, HEADER_W, HEADER_H))
    shade_alpha = ImageChops.multiply(shade_alpha, covered)
    shade = Image.new("RGBA", (HEADER_W, shade_h), (27, 33, 64, 0))
    shade.putalpha(shade_alpha)
    strip = base.crop((0, HEADER_H - shade_h, HEADER_W, HEADER_H))
    strip.alpha_composite(shade)
    base.paste(strip, (0, HEADER_H - shade_h))
    return base


# ── stamp: perforated stamp with the emblem and 极客班, postmark YUGC with wavy lines ──
STAMP_W, STAMP_H = 300, 200


def stamp_svg() -> str:
    sw, sh = 132, 160
    sx, sy = -sw / 2, -sh / 2
    holes = []
    step = 14.6
    n = round(sw / step)
    for i in range(n + 1):
        x = sx + i * sw / n
        holes.append(
            f'<circle cx="{x:.2f}" cy="{sy}" r="5.2"/><circle cx="{x:.2f}" cy="{sy + sh}" r="5.2"/>'
        )
    m = round(sh / step)
    for i in range(m + 1):
        y = sy + i * sh / m
        holes.append(
            f'<circle cx="{sx}" cy="{y:.2f}" r="5.2"/><circle cx="{sx + sw}" cy="{y:.2f}" r="5.2"/>'
        )
    waves = []
    for k in range(3):
        y0 = -22 + k * 20
        pts = [f"{x},{y0 + math.sin(x / 9) * 5:.2f}" for x in range(-150, -46, 4)]
        waves.append(f'<polyline points="{" ".join(pts)}" fill="none"/>')
    return f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{STAMP_W}" height="{STAMP_H}" viewBox="0 0 {STAMP_W} {STAMP_H}">
<defs>
  <mask id="perf" maskUnits="userSpaceOnUse" x="-100" y="-100" width="300" height="300">
    <rect x="-100" y="-100" width="300" height="300" fill="#fff"/>
    <g fill="#000">{"".join(holes)}</g>
  </mask>
  <clipPath id="emblem"><circle cx="0" cy="-16" r="37"/></clipPath>
  <filter id="drop" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="3.5"/>
    <feOffset dx="0" dy="3" result="b"/>
    <feFlood flood-color="#1b2140" flood-opacity="0.18"/>
    <feComposite in2="b" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<g transform="translate(210,100) rotate(4)" filter="url(#drop)">
  <g mask="url(#perf)">
    <rect x="{sx}" y="{sy}" width="{sw}" height="{sh}" fill="#ffffff"/>
  </g>
  <rect x="{sx + 11}" y="{sy + 11}" width="{sw - 22}" height="{sh - 22}" rx="2" fill="{COBALT_SOFT}"/>
  <image href="{data_uri(LOGO)}" x="-37" y="-53" width="74" height="74" clip-path="url(#emblem)"/>
  <text x="0" y="52" text-anchor="middle" font-family="PingFang SC" font-weight="700" font-size="21" fill="{COBALT}">极客班</text>
</g>
<g transform="translate(150,118) rotate(-11)" stroke="{POSTMARK}" stroke-opacity="0.72" stroke-width="3.2" stroke-linecap="round">
  <circle cx="0" cy="0" r="42" fill="none"/>
  <circle cx="0" cy="0" r="32" fill="none"/>
  {"".join(waves)}
  <text x="0" y="7" text-anchor="middle" font-family="PingFang SC" font-weight="700" font-size="18" fill="{POSTMARK}" fill-opacity="0.8" stroke="none">YUGC</text>
</g>
</svg>"""


# ── wax seal next to the signature ──
SEAL = 144


def seal_svg() -> str:
    c = SEAL / 2
    pts = []
    for i in range(72):
        a = i / 72 * math.pi * 2
        r = 54 + 3.2 * math.sin(a * 7 + 0.6) + 1.8 * math.sin(a * 11 + 2.1)
        pts.append(f"{c + math.cos(a) * r:.2f},{c + math.sin(a) * r:.2f}")
    blob = "M" + " L".join(pts) + " Z"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{SEAL}" height="{SEAL}" viewBox="0 0 {SEAL} {SEAL}">
<defs>
  <radialGradient id="wax" cx="0.42" cy="0.38" r="0.62">
    <stop offset="0" stop-color="#4b5de0"/>
    <stop offset="1" stop-color="#23309a"/>
  </radialGradient>
  <clipPath id="emblem"><circle cx="{c}" cy="{c}" r="{0.56 * 104 / 2:.2f}"/></clipPath>
  <filter id="drop" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
    <feOffset dx="0" dy="4" result="b"/>
    <feFlood flood-color="#10164a" flood-opacity="0.28"/>
    <feComposite in2="b" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<g filter="url(#drop)">
  <path d="{blob}" fill="url(#wax)"/>
  <path d="{blob}" fill="none" stroke="#dfe4ff" stroke-opacity="0.6" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="{c}" cy="{c}" r="37" fill="none" stroke="#0a1046" stroke-opacity="0.45" stroke-width="3.2"/>
  <circle cx="{c}" cy="{c}" r="40" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.6"/>
  <image href="{data_uri(LOGO)}" x="{c - 29}" y="{c - 29}" width="58" height="58" clip-path="url(#emblem)" opacity="0.55" style="mix-blend-mode:multiply"/>
  <ellipse cx="{c - 16}" cy="{c - 20}" rx="14" ry="7" fill="#ffffff" fill-opacity="0.16" transform="rotate(-30 {c - 16} {c - 20})"/>
</g>
</svg>"""


# ── airmail band closing the bottom of the letter ──
BAND_W, BAND_H = 1200, 24


def band_svg() -> str:
    r = 8  # 4px at 1x, the radius of the letter paper
    shape = f"M0,0 H{BAND_W} V{BAND_H - r} Q{BAND_W},{BAND_H} {BAND_W - r},{BAND_H} H{r} Q0,{BAND_H} 0,{BAND_H - r} Z"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{BAND_W}" height="{BAND_H}" viewBox="0 0 {BAND_W} {BAND_H}">
<defs>{airmail_pattern("air", 14, 24)}<clipPath id="c"><path d="{shape}"/></clipPath></defs>
<rect x="0" y="0" width="{BAND_W}" height="{BAND_H}" fill="url(#air)" clip-path="url(#c)"/>
</svg>"""


def export(
    img: Image.Image,
    name: str,
    display: tuple[int, int],
    quant: tuple[str, ...] = ("--quality=78-96",),
) -> dict:
    raw = os.path.join(WORK, name + "-raw.png")
    img.save(raw)
    q = os.path.join(WORK, name + "-q.png")
    subprocess.run(
        [
            "pngquant",
            *quant,
            "--speed=1",
            "--strip",
            "--force",
            "--output",
            q,
            raw,
        ],
        check=True,
    )
    subprocess.run(["oxipng", "-o", "4", "--strip", "all", "--quiet", q], check=True)
    with open(q, "rb") as f:
        data = f.read()
    digest = hashlib.sha256(data).hexdigest()[:8]
    file = f"{name}-{digest}.png"
    with open(os.path.join(OUT, file), "wb") as f:
        f.write(data)
    return {
        "name": name,
        "file": file,
        "bytes": len(data),
        "pixels": list(img.size),
        "display": list(display),
    }


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    # Pieces from earlier runs stay: their names carry their own hash, and mail that was
    # already sent keeps pointing at them. MANIFEST.txt / manifest.json list only this run.
    pieces = [
        export(
            build_header(), "header", (HEADER_W // 2, HEADER_H // 2), ("192", "--nofs")
        ),
        export(render_svg(stamp_svg(), "stamp"), "stamp", (STAMP_W // 2, STAMP_H // 2)),
        export(render_svg(seal_svg(), "seal"), "seal", (SEAL // 2, SEAL // 2)),
        export(
            render_svg(band_svg(), "airmail"), "airmail", (BAND_W // 2, BAND_H // 2)
        ),
    ]
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(pieces, f, ensure_ascii=False, indent=2)
    lines = ["# mail envelope pieces (#148): file  bytes  pixels(2x)  display(1x)"]
    for p in pieces:
        lines.append(
            f"{p['file']}  {p['bytes']}  {p['pixels'][0]}x{p['pixels'][1]}  {p['display'][0]}x{p['display'][1]}"
        )
    with open(os.path.join(OUT, "MANIFEST.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    shutil.rmtree(WORK)


if __name__ == "__main__":
    main()
