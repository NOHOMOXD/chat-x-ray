#!/usr/bin/env python3
"""Generate the static extension icons (no external dependencies required)."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icons"


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 1.0 if x >= edge1 else 0.0
    t = clamp((x - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def rounded_box_sdf(x: float, y: float, half: float, radius: float) -> float:
    qx = abs(x) - (half - radius)
    qy = abs(y) - (half - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def hsl_to_rgb(h: float, s: float, l: float) -> tuple[float, float, float]:
    s /= 100.0
    l /= 100.0
    c = (1.0 - abs(2.0 * l - 1.0)) * s
    hp = (h % 360.0) / 60.0
    x = c * (1.0 - abs(hp % 2.0 - 1.0))
    if hp < 1.0:
        r, g, b = c, x, 0.0
    elif hp < 2.0:
        r, g, b = x, c, 0.0
    elif hp < 3.0:
        r, g, b = 0.0, c, x
    elif hp < 4.0:
        r, g, b = 0.0, x, c
    elif hp < 5.0:
        r, g, b = x, 0.0, c
    else:
        r, g, b = c, 0.0, x
    m = l - c / 2.0
    return (r + m, g + m, b + m)


def blend(dst, src, alpha: float):
    if alpha <= 0.0:
        return dst
    return tuple(src[i] * alpha + dst[i] * (1.0 - alpha) for i in range(3))


def render_icon(size: int) -> bytes:
    supersample = 8 if size <= 32 else 4
    hi = size * supersample
    pixels = [(0.0, 0.0, 0.0, 0.0)] * hi * hi

    for py in range(hi):
        # Normalized coordinates with pixel centres.
        yn = ((py + 0.5) / hi) * 2.0 - 1.0
        for px in range(hi):
            xn = ((px + 0.5) / hi) * 2.0 - 1.0
            rgb = (0.0, 0.0, 0.0)
            alpha = 0.0

            # Rounded dark tile.
            box = rounded_box_sdf(xn, yn, 0.92, 0.24)
            if box < 0.012:
                tile_alpha = smoothstep(0.012, -0.008, box)
                tile = (0.075, 0.075, 0.09)
                # Slightly lighter inner plate so the icon reads at 16 px.
                inner = rounded_box_sdf(xn, yn, 0.80, 0.20)
                if inner < 0.0:
                    tile = (0.105, 0.098, 0.125)
                rgb = blend(rgb, tile, tile_alpha)
                alpha = tile_alpha

                # Thin warm border.
                border = 1.0 - smoothstep(0.0, 0.045, abs(box + 0.006))
                if border > 0.0:
                    rgb = blend(rgb, (0.75, 0.32, 0.16), border * 0.55)

            # Almond eye outline + iris.
            # y_limit controls the lens shape; the bright fill only lives
            # between the outer ellipse and a slightly shrunken inner one.
            lens = 0.34 * (max(0.0, 1.0 - xn * xn) ** 0.82) + 1e-6
            normalized_y = abs(yn) / lens
            if abs(xn) < 0.86 and normalized_y < 1.0:
                t = clamp((xn + 0.86) / 1.72)
                hue = 52.0 - 52.0 * t
                eye_color = hsl_to_rgb(hue, 92.0, 60.0)
                # Outer rim is darker; interior is bright.
                rim = smoothstep(0.72, 0.98, normalized_y)
                edge = smoothstep(0.70, 1.0, abs(xn))
                eye_alpha = 0.96 - 0.45 * rim - 0.35 * edge
                rgb = blend(rgb, eye_color, eye_alpha)
                alpha = max(alpha, eye_alpha)

                # Sclera highlight just above the iris.
                if normalized_y < 0.62 and abs(xn) > 0.42:
                    rgb = blend(rgb, (1.0, 0.94, 0.72), 0.20)

            iris_distance = math.hypot(xn, yn + 0.01)
            if iris_distance < 0.225:
                iris_alpha = smoothstep(0.225, 0.205, iris_distance)
                iris_color = hsl_to_rgb(8.0, 90.0, 48.0)
                rgb = blend(rgb, iris_color, iris_alpha)
                alpha = max(alpha, iris_alpha)
            if iris_distance < 0.105:
                pupil_alpha = smoothstep(0.105, 0.085, iris_distance)
                rgb = blend(rgb, (0.055, 0.05, 0.065), pupil_alpha)
                alpha = max(alpha, pupil_alpha)

            # Tiny specular highlight.
            highlight = math.hypot(xn + 0.07, yn + 0.08)
            if highlight < 0.045:
                rgb = blend(rgb, (1.0, 0.97, 0.85), smoothstep(0.045, 0.02, highlight))
                alpha = max(alpha, 0.92)

            pixels[py * hi + px] = (rgb[0], rgb[1], rgb[2], clamp(alpha))

    # Downsample with alpha-aware box filtering.
    out = bytearray()
    for y in range(size):
        out.append(0)  # PNG filter type: none
        for x in range(size):
            r = g = b = a = 0.0
            for yy in range(supersample):
                for xx in range(supersample):
                    pr, pg, pb, pa = pixels[(y * supersample + yy) * hi + (x * supersample + xx)]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            count = supersample * supersample
            if a > 0.0:
                r /= a
                g /= a
                b /= a
            a /= count
            out.extend(
                (
                    int(round(clamp(r) * 255)),
                    int(round(clamp(g) * 255)),
                    int(round(clamp(b) * 255)),
                    int(round(clamp(a) * 255)),
                )
            )
    return bytes(out)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(ICON_DIR / f"icon{size}.png", size, render_icon(size))
        print(f"icons/icon{size}.png")


if __name__ == "__main__":
    main()
