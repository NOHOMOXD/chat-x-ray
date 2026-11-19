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


def render_icon(size: int) -> bytes:
    supersample = 8
    hi = size * supersample
    pixels = []
    for py in range(hi):
        for px in range(hi):
            x, y = (px + 0.5) / hi, (py + 0.5) / hi
            dx, dy = abs(x - 0.5), abs(y - 0.5)
            radius = math.hypot(dx, dy)
            # Two tapered lids around a lavender-rimmed lens.
            curve = (dx / 0.48) ** 2
            outer = 0.456 - 0.30 * curve
            inner = 0.366 - 0.21 * curve
            lid = dx < 0.48 and inner <= dy <= outer
            cross = dx + dy <= 0.293 and abs(dx - dy) <= 0.065
            lavender = (0.77, 0.56, 1.0)
            ink = (0.13, 0.12, 0.16)
            rgb = lavender if 0.244 < radius <= 0.313 or cross else ink
            # A fine light rim keeps the dark lids visible on charcoal toolbars.
            if lid and (outer - dy < 0.021 or dy - inner < 0.021):
                rgb = (0.75, 0.69, 0.84)
            pixels.append((*rgb, float(lid or radius <= 0.313)))

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
