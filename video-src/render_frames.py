"""Render one PNG still per scene (2400x1350, downscaled to 1080p by ffmpeg)."""

from __future__ import annotations

import json
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from script import CHAPTERS

W, H = 1920, 1080
S = 1.25                      # supersample factor -> 2400 x 1350 canvas
CW, CH = int(W * S), int(H * S)

BG_TOP = (246, 242, 233)
BG_BOT = (228, 221, 207)
INK = (15, 34, 29)
MUTED = (94, 110, 103)
EMERALD = (14, 91, 73)
EMERALD_DEEP = (9, 63, 51)
EMERALD_SOFT = (176, 212, 198)
CARD = (255, 255, 255)
BORDER = (219, 211, 195)
PAPER = (250, 248, 243)

FONT_DIR = "/usr/share/fonts/truetype/dejavu"


@lru_cache(maxsize=None)
def font(size: float, bold: bool = False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(os.path.join(FONT_DIR, name), int(round(size * S)))


def px(v: float) -> int:
    return int(round(v * S))


@lru_cache(maxsize=None)
def _measure(text: str, size: float, bold: bool):
    tmp = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    return tmp.textlength(text, font=font(size, bold)) / S


def wrap(text: str, size: float, width: float, bold: bool = False) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if _measure(t, size, bold) <= width or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def text_block(d: ImageDraw.ImageDraw, xy, text, size, width, *, bold=False,
               color=INK, leading=1.28, max_lines=None):
    x, y = xy
    lines = wrap(text, size, width, bold)
    if max_lines:
        lines = lines[:max_lines]
    step = size * leading
    for line in lines:
        d.text((px(x), px(y)), line, font=font(size, bold), fill=color)
        y += step
    return y


def shadow_card(im: Image.Image, box, radius, blur=22, alpha=52, dy=14):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = [px(v) for v in box]
    dl.rounded_rectangle([x0, y0 + px(dy), x1, y1 + px(dy)], radius=px(radius),
                         fill=(28, 42, 36, alpha))
    layer = layer.filter(ImageFilter.GaussianBlur(px(blur)))
    im.alpha_composite(layer)


def background() -> Image.Image:
    im = Image.new("RGB", (CW, CH), BG_TOP)
    d = ImageDraw.Draw(im)
    for y in range(CH):
        t = y / CH
        col = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        d.line([(0, y), (CW, y)], fill=col)
    # warm emerald glow top-right + soft dot grid
    glow = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse([px(1250), px(-420), px(2250), px(560)], fill=(14, 91, 73, 26))
    dg.ellipse([px(-380), px(720), px(520), px(1560)], fill=(190, 160, 90, 22))
    im = Image.alpha_composite(im.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(px(120))))
    d = ImageDraw.Draw(im)
    for gy in range(px(40), CH, px(64)):
        for gx in range(px(40), CW, px(64)):
            d.point((gx, gy), fill=(120, 130, 120, 26))
    return im


def draw_header(im: Image.Image, d: ImageDraw.ImageDraw, chapter, scene_i, total):
    # logo mark
    shadow_card(im, (96, 56, 180, 140), 24, blur=14, alpha=60, dy=6)
    d.rounded_rectangle([px(96), px(56), px(180), px(140)], radius=px(24), fill=EMERALD)
    d.text((px(138), px(98)), "F", font=font(52, True), fill=(255, 255, 255), anchor="mm")
    d.text((px(202), px(78)), "ForgeERP", font=font(38, True), fill=INK)
    d.text((px(203), px(120)), "User guide video · demo data: Shree Forge Industries",
           font=font(19), fill=MUTED)
    label = f"CHAPTER {chapter['id']} / {len(CHAPTERS):02d}"
    d.text((px(1824), px(74)), label, font=font(20, True), fill=EMERALD, anchor="ra")
    d.text((px(1824), px(104)), chapter["title"], font=font(28, True), fill=INK, anchor="ra")
    d.text((px(1824), px(140)), f"scene {scene_i} of {total}",
           font=font(18), fill=MUTED, anchor="ra")
    d.line([px(96), px(170), px(1824), px(170)], fill=(198, 190, 173), width=px(1.4))


def draw_footer(im: Image.Image, d: ImageDraw.ImageDraw, frac: float, caption: str):
    y = 1004
    d.rounded_rectangle([px(96), px(y), px(1824), px(y + 6)], radius=px(3), fill=(211, 203, 186))
    if frac > 0:
        d.rounded_rectangle([px(96), px(y), px(96 + 1728 * frac), px(y + 6)],
                            radius=px(3), fill=EMERALD)
    d.ellipse([px(96 + 1728 * frac - 7), px(y - 4), px(96 + 1728 * frac + 7), px(y + 10)],
              fill=EMERALD)
    d.text((px(96), px(y + 26)), caption, font=font(19), fill=MUTED)
    d.text((px(1824), px(y + 26)), "Print = report = posted totals · append-only ledgers",
           font=font(19), fill=MUTED, anchor="ra")


def draw_steps(d: ImageDraw.ImageDraw, scene, step_i: int, total: int):
    y = 214
    label = f"STEP {step_i} OF {total}"
    w = _measure(label, 19, True) + 30
    d.rounded_rectangle([px(96), px(y), px(96 + w), px(y + 40)], radius=px(20),
                        outline=EMERALD_SOFT, width=px(1.6))
    d.text((px(96 + w / 2), px(y + 20)), label, font=font(19, True), fill=EMERALD, anchor="mm")


def draw_left_column(d: ImageDraw.ImageDraw, scene, step_i: int, total: int):
    draw_steps(d, scene, step_i, total)
    y = text_block(d, (96, 286), scene["title"], 62, 560, bold=True, leading=1.12)
    y += 26
    d.line([px(96), px(y), px(190), px(y)], fill=EMERALD, width=px(5))
    y += 44
    for point in scene.get("points", []):
        d.ellipse([px(100), px(y + 11), px(112), px(y + 23)], fill=EMERALD)
        y = text_block(d, (138, y), point, 26, 468, color=(38, 56, 50), leading=1.24)
        y += 26


def fit_image(im: Image.Image, box_w: int, box_h: int) -> Image.Image:
    ratio = min(box_w / im.width, box_h / im.height)
    return im.resize((max(1, int(im.width * ratio)), max(1, int(im.height * ratio))),
                     Image.LANCZOS)


def draw_screen(im: Image.Image, d: ImageDraw.ImageDraw, scene, chapter):
    box = (640, 214, 1824, 962)
    x0, y0, x1, y1 = box
    shadow_card(im, box, 18, blur=26, alpha=64, dy=18)
    d.rounded_rectangle([px(x0), px(y0), px(x1), px(y1)], radius=px(18), fill=CARD,
                        outline=(210, 202, 185), width=px(1.5))

    # window chrome
    bar_h = 42
    d.rounded_rectangle([px(x0), px(y0), px(x1), px(y0 + bar_h)], radius=px(18), fill=(240, 236, 227))
    d.rectangle([px(x0), px(y0 + bar_h - 18), px(x1), px(y0 + bar_h)], fill=(240, 236, 227))
    for i, col in enumerate([(226, 122, 106), (226, 186, 96), (140, 195, 150)]):
        cx = x0 + 26 + i * 24
        d.ellipse([px(cx - 6), px(y0 + 15), px(cx + 6), px(y0 + 27)], fill=col)
    url = "erp.shreeforge.example.in  ·  Shree Forge Industries  ·  FY 2627"
    pill_w = _measure(url, 17, False) + 40
    d.rounded_rectangle([px((x0 + x1) / 2 - pill_w / 2), px(y0 + 9),
                         px((x0 + x1) / 2 + pill_w / 2), px(y0 + 33)],
                        radius=px(12), fill=(255, 255, 255), outline=(216, 208, 191), width=px(1))
    d.text((px((x0 + x1) / 2), px(y0 + 21)), url, font=font(17), fill=MUTED, anchor="mm")

    pad = 16
    avail_w = (x1 - x0 - 2 * pad) * S
    avail_h = (y1 - y0 - bar_h - 2 * pad) * S
    card_aspect = avail_w / avail_h
    shot = Image.open(os.path.join(os.path.dirname(__file__), "..", "docs",
                                   "manual-screenshots", scene["image"])).convert("RGB")
    focus = scene.get("focus")

    # Tall screenshots get cropped around the region that matters instead of
    # being shrunk to an unreadable thumbnail.
    crop = None
    if shot.width / shot.height < card_aspect * 0.94:
        if focus:
            fx, fy, fw, fh = focus
        else:
            fx, fy, fw, fh = 0, 0, shot.width, min(shot.height, int(shot.width / card_aspect))
        fw_p, fh_p = fw * 1.10, fh * 1.10
        cw = min(shot.width, fw_p)
        chh = cw / card_aspect
        if chh > shot.height:
            chh = shot.height
            cw = chh * card_aspect
        if chh < fh_p:
            chh = min(shot.height, fh_p)
            cw = min(shot.width, chh * card_aspect)
            chh = cw / card_aspect
        cx = fx + fw / 2
        cy = fy + fh / 2
        cx0 = min(max(0, cx - cw / 2), shot.width - cw)
        cy0 = min(max(0, cy - chh / 2), shot.height - chh)
        crop = (cx0, cy0, cx0 + cw, cy0 + chh)
        shot = shot.crop(tuple(int(round(v)) for v in crop))
        if focus:
            focus = [fx - crop[0], fy - crop[1], fw, fh]

    fitted = fit_image(shot, avail_w, avail_h)
    area_x = (x0 + pad) * S
    area_y = (y0 + bar_h + pad) * S
    area_w = (x1 - x0 - 2 * pad) * S
    area_h = (y1 - y0 - bar_h - 2 * pad) * S
    px_pos = int(area_x + (area_w - fitted.width) / 2)
    py_pos = int(area_y + (area_h - fitted.height) / 2)

    radius = 34 if scene.get("narrow") else 6
    mask = Image.new("L", fitted.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, fitted.width - 1, fitted.height - 1],
                                           radius=int(radius * S), fill=255)
    im.paste(fitted, (px_pos, py_pos), mask)

    # focus spotlight on the part of the UI that matters for this scene
    if focus:
        fx, fy, fw, fh = focus
        scale = fitted.width / shot.width
        rx0 = px_pos + fx * scale
        ry0 = py_pos + fy * scale
        rx1 = rx0 + fw * scale
        ry1 = ry0 + fh * scale
        rx0, ry0 = max(px_pos, rx0), max(py_pos, ry0)
        rx1, ry1 = min(px_pos + fitted.width, rx1), min(py_pos + fitted.height, ry1)
        dim = Image.new("RGBA", im.size, (12, 26, 22, 0))
        dm = Image.new("L", im.size, 58)
        hl = Image.new("L", im.size, 0)
        ImageDraw.Draw(hl).rounded_rectangle([rx0, ry0, rx1, ry1], radius=px(10), fill=255)
        hl = hl.filter(ImageFilter.GaussianBlur(px(2)))
        dm = Image.composite(Image.new("L", im.size, 0), dm, hl)
        dim.putalpha(dm)
        im.alpha_composite(dim)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([rx0, ry0, rx1, ry1], radius=px(10), outline=EMERALD, width=px(3))
        # accent ticks on the focus corners
        for cx, cy, sx, sy in ((rx0, ry0, 1, 1), (rx1, ry0, -1, 1),
                               (rx0, ry1, 1, -1), (rx1, ry1, -1, -1)):
            d.line([cx, cy, cx + sx * px(16), cy], fill=EMERALD, width=px(5))
            d.line([cx, cy, cx, cy + sy * px(16)], fill=EMERALD, width=px(5))


def render_chapter_card(im: Image.Image, d: ImageDraw.ImageDraw, chapter):
    d.rounded_rectangle([px(96), px(232), px(96 + 300), px(232 + 44)], radius=px(22),
                        fill=EMERALD)
    d.text((px(246), px(254)), f"CHAPTER {chapter['id']}", font=font(21, True),
           fill=(255, 255, 255), anchor="mm")
    d.text((px(96), px(330)), chapter["title"], font=font(76, True), fill=INK)
    d.text((px(98), px(432)), chapter["subtitle"], font=font(30), fill=MUTED)
    y = 520
    for point in chapter["scenes"][0].get("points", []):
        d.rounded_rectangle([px(96), px(y - 4), px(118), px(y + 18)], radius=px(6), fill=EMERALD_SOFT)
        d.line([px(101), px(y + 8), px(107), px(y + 14)], fill=EMERALD_DEEP, width=px(2.4))
        d.line([px(107), px(y + 14), px(114), px(y + 2)], fill=EMERALD_DEEP, width=px(2.4))
        d.text((px(140), px(y - 6)), point, font=font(28), fill=(38, 56, 50))
        y += 62
    # big ghost numeral on the right
    d.text((px(1780), px(560)), chapter["id"], font=font(430, True),
           fill=(14, 91, 73, 46), anchor="rm")
    d.text((px(1780), px(860)), f"{len(chapter['scenes']) - 1} steps · guided walkthrough", font=font(24), fill=(120, 132, 124), anchor="rm")


def render_outro(im: Image.Image, d: ImageDraw.ImageDraw, scene):
    d.rounded_rectangle([px(96), px(250), px(96 + 260), px(250 + 44)], radius=px(22), fill=EMERALD)
    d.text((px(226), px(272)), "COURSE COMPLETE", font=font(21, True), fill=(255, 255, 255),
           anchor="mm")
    d.text((px(96), px(336)), scene["title"], font=font(72, True), fill=INK)
    y = 470
    for point in scene.get("points", []):
        d.rounded_rectangle([px(96), px(y), px(1180), px(y + 96)], radius=px(16), fill=(255, 255, 255),
                            outline=(214, 206, 189), width=px(1.4))
        d.ellipse([px(120), px(y + 36), px(144), px(y + 60)], fill=EMERALD)
        d.text((px(162), px(y + 34)), point, font=font(28), fill=(38, 56, 50))
        y += 118
    d.text((px(96), px(880)), "ForgeERP · Shree Forge Industries (demo data) · reviews and compliance with your CA",
           font=font(22), fill=MUTED)


def render_scene(chapter, idx: int, total: int):
    scene = chapter["scenes"][idx]
    im = background()
    d = ImageDraw.Draw(im)
    draw_header(im, d, chapter, idx + 1, total)

    if scene.get("kind") == "chapter":
        render_chapter_card(im, d, chapter)
    elif scene.get("kind") == "outro":
        render_outro(im, d, scene)
    else:
        draw_steps(d, scene, idx, total - 1)
        draw_left_column(d, scene, idx, total - 1)
        draw_screen(im, d, scene, chapter)

    draw_footer(im, d, (idx + 1) / total,
                f"{chapter['title']} · scene {idx + 1}/{total}")
    return im.convert("RGB")


def main():
    out = os.path.join(os.path.dirname(__file__), "frames")
    os.makedirs(out, exist_ok=True)
    made = []
    for chapter in CHAPTERS:
        total = len(chapter["scenes"])
        for idx in range(total):
            im = render_scene(chapter, idx, total)
            path = os.path.join(out, f"{chapter['slug']}-s{idx + 1:02d}.png")
            im.save(path, optimize=True)
            made.append(path)
    print(json.dumps({"frames": len(made), "dir": out}, indent=2))


if __name__ == "__main__":
    main()
