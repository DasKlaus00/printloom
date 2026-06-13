"""Generate Printloom app icons (stacked plates + 4D badge) with Pillow.
Run from anywhere: `python frontend/scripts/gen_icons.py` — writes PNGs into ../public.
Requires Pillow (`pip install Pillow`)."""
import os
from PIL import Image, ImageDraw, ImageFont

SS = 4  # supersample factor for crisp edges
FONT_PATH = "C:/Windows/Fonts/arialbd.ttf"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public")

# Design coordinates in a 512x512 reference frame
TOP    = (0x3b, 0x82, 0xf6)   # blue-500
BOTTOM = (0x1d, 0x4e, 0xd8)   # blue-700
NAVY   = (0x17, 0x25, 0x54)   # badge
WHITE  = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size, rounded=True):
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # vertical gradient background
    bg = Image.new("RGBA", (n, n))
    bd = ImageDraw.Draw(bg)
    for y in range(n):
        bd.line([(0, y), (n, y)], fill=lerp(TOP, BOTTOM, y / max(1, n - 1)) + (255,))

    s = n / 512.0  # scale: 512 reference units → canvas pixels

    if rounded:
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=round(112 * s), fill=255)
        img.paste(bg, (0, 0), mask)
    else:
        img.paste(bg, (0, 0))

    # stacked plates
    plates = [(118, 0.95), (190, 0.78), (262, 0.60)]
    for y, op in plates:
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [96 * s, y * s, (96 + 320) * s, (y + 54) * s],
            radius=16 * s, fill=WHITE + (round(255 * op),))
        img = Image.alpha_composite(img, layer)

    # 4D badge
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([150 * s, 352 * s, (150 + 212) * s, (352 + 96) * s],
                        radius=48 * s, fill=NAVY + (255,))
    font = ImageFont.truetype(FONT_PATH, 70 * s)
    d.text((256 * s, 398 * s), "4D", font=font, fill=WHITE + (255,), anchor="mm")

    return img.resize((size, size), Image.LANCZOS)


targets = [
    ("favicon-16.png", 16, True),
    ("favicon-32.png", 32, True),
    ("icon-192.png", 192, True),
    ("icon-512.png", 512, True),
    ("maskable-512.png", 512, False),
    ("apple-touch-icon.png", 180, False),
]
for name, sz, rnd in targets:
    draw_icon(sz, rnd).save(os.path.join(OUT_DIR, name))
    print("wrote", name, sz)
