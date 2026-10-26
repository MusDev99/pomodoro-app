#!/usr/bin/env python3
"""Generate the PWA icons (pure stdlib PNG encoder). Run: python3 scripts/make_icons.py"""

import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
BRAND = (243, 139, 160)   # --accent-focus
WHITE = (255, 255, 255)
DEEP = (214, 98, 124)     # darker ring for depth


def png(size, pixel):
    """Encode an RGB PNG of `size` x `size`, where pixel(x, y) returns (r, g, b)."""
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: none
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def icon_pixel(size, safe_zone):
    """A pink tile with a white timer ring. safe_zone shrinks the artwork for maskable icons."""
    c = size / 2
    scale = 1.0 if not safe_zone else 0.8
    ring_outer = size * 0.34 * scale
    ring_inner = size * 0.27 * scale
    dot = size * 0.06 * scale

    def pixel(x, y):
        dx, dy = x + 0.5 - c, y + 0.5 - c
        d = math.hypot(dx, dy)
        if ring_inner <= d <= ring_outer:
            return WHITE
        if d < dot:
            return WHITE
        # subtle vertical gradient on the background
        t = y / size
        return tuple(round(BRAND[i] * (1 - 0.12 * t) + DEEP[i] * 0.12 * t) for i in range(3))

    return pixel


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = {
        "icon-192.png": (192, False),
        "icon-512.png": (512, False),
        "icon-maskable-512.png": (512, True),
        "apple-touch-icon.png": (180, False),
    }
    for name, (size, safe) in targets.items():
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(png(size, icon_pixel(size, safe)))
        print("wrote", os.path.join("icons", name))


if __name__ == "__main__":
    main()
