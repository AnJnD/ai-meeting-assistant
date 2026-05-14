"""Render the brand icon as PNG files using Pillow only.

Concept: rounded-square blue badge with a clean white microphone
silhouette plus a small green "listening" dot indicator.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.abspath(__file__))

GRAD_TOP = (26, 115, 232)     # #1a73e8
GRAD_BOT = (13, 71, 161)      # #0d47a1
WHITE = (255, 255, 255, 255)
DOT   = (52, 168, 83, 255)    # #34a853 listening green

def vertical_gradient(size, top, bot):
    img = Image.new("RGB", (size, size), top)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img

def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def draw_mic(draw, S):
    """Draw a white mic on an S-pixel canvas (S is the supersampled edge).

    Reference coordinates against a 128-unit grid, shifted slightly upward
    so the mic is visually centered once the stand is drawn.
    """
    U = S / 128.0        # unit
    cx = S / 2
    cy = S / 2 - 6 * U   # nudge up

    # Capsule (rounded pill)
    cw = 46 * U
    ch = 66 * U
    cap = [cx - cw / 2, cy - ch / 2,
           cx + cw / 2, cy + ch / 2]
    draw.rounded_rectangle(cap, radius=cw / 2, fill=WHITE)

    # U-shaped "cradle" — horseshoe under the capsule
    lw = max(2, int(7 * U))
    crad_w = 66 * U
    crad_h = 40 * U
    crad_top = cy + ch / 2 - 16 * U
    cradle = [cx - crad_w / 2, crad_top,
              cx + crad_w / 2, crad_top + crad_h]
    # Arc from 20 deg to 160 deg (bottom half)
    draw.arc(cradle, start=20, end=160, fill=WHITE, width=lw)

    # Stand
    stand_top = crad_top + crad_h / 2 + 4 * U
    stand_bot = stand_top + 18 * U
    draw.line([(cx, stand_top), (cx, stand_bot)], fill=WHITE, width=lw)

    # Base
    base_half = 22 * U
    draw.line([(cx - base_half, stand_bot), (cx + base_half, stand_bot)],
              fill=WHITE, width=lw)

def draw_listening_dot(img, S):
    """Small green status dot in the top-right corner with white ring."""
    U = S / 128.0
    r  = 11 * U
    cx = S - 24 * U
    cy = 24 * U
    d = ImageDraw.Draw(img)
    # white halo ring (ensures contrast over the blue)
    ring = max(2, int(3 * U))
    d.ellipse([cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring],
              fill=WHITE)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DOT)

def render(size, out_path, with_dot=True):
    SS = 4
    big = size * SS
    radius = int(big * 0.22)

    grad = vertical_gradient(big, GRAD_TOP, GRAD_BOT).convert("RGBA")
    mask = rounded_mask(big, radius)
    badge = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    badge.paste(grad, (0, 0), mask)

    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_mic(ImageDraw.Draw(layer), big)
    # The 16-px icon is too small to carry the dot legibly; skip it
    if with_dot:
        draw_listening_dot(layer, big)
    badge = Image.alpha_composite(badge, layer)

    final = badge.resize((size, size), Image.LANCZOS)
    final.save(out_path, "PNG")
    print("wrote", out_path)

if __name__ == "__main__":
    render(16,  os.path.join(OUT, "icon-16.png"),  with_dot=False)
    render(32,  os.path.join(OUT, "icon-32.png"),  with_dot=True)
    render(48,  os.path.join(OUT, "icon-48.png"),  with_dot=True)
    render(128, os.path.join(OUT, "icon-128.png"), with_dot=True)
