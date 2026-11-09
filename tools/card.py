"""The Code Lane headline image. The board shows covers as a 64 x 36 grid of LED dots lit by brightness in one tint
per project, so the picture is a big shaded subject and a heavy wordmark: Squeektoshi running in his wheel on the
left, WHEEL MATES on the right, seeds flying. Drawn with shapes at 2560 x 1440, saved at 1280 x 720, previewed
through the board's dot grid. Own drawing. Run: python tools/card.py"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 2560, 1440
out = Path(__file__).resolve().parent.parent / "docs"

def font(size):
    for name in ("impact.ttf", "ariblk.ttf", "arialbd.ttf"):
        try: return ImageFont.truetype(r"C:\Windows\Fonts\%s" % name, size)
        except OSError: pass
    return ImageFont.load_default()

def radial(size, inner, outer, cx=0.4, cy=0.35):
    w, h = size
    layer = Image.new("RGBA", size, outer + (255,))
    d = ImageDraw.Draw(layer)
    steps = 40
    for i in range(steps, 0, -1):
        t = i / steps
        col = tuple(int(outer[k] + (inner[k] - outer[k]) * (1 - t)) for k in range(3)) + (255,)
        bw, bh = w * t, h * t
        d.ellipse([cx * w - bw * cx, cy * h - bh * cy, cx * w + bw * (1 - cx), cy * h + bh * (1 - cy)], fill=col)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, w - 1, h - 1], fill=255)
    layer.putalpha(mask)
    return layer

FUR, FUR_DK, FUR_LT = (236, 160, 70), (120, 70, 20), (255, 214, 150)
BELLY, BELLY_DK = (255, 240, 220), (200, 170, 140)
INK, WHITE, NOSE = (14, 10, 8), (255, 255, 255), (250, 150, 150)
RIM, RIM_LT, RIM_DK, RUNG, HUB = (150, 150, 168), (230, 230, 242), (70, 70, 84), (210, 210, 224), (240, 200, 110)
SEED, SEED_DK = (255, 200, 90), (110, 60, 10)

im = Image.new("RGB", (W, H), (6, 6, 8))
glow = Image.new("RGB", (W, H), (6, 6, 8))
ImageDraw.Draw(glow).ellipse([-100, 60, 1420, 1440], fill=(30, 24, 16))
im = glow.filter(ImageFilter.GaussianBlur(170))

lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ld = ImageDraw.Draw(lay)
def shaded(box, inner, outer, cx=0.4, cy=0.35):
    x0, y0, x1, y1 = box
    lay.alpha_composite(radial((x1 - x0, y1 - y0), inner, outer, cx, cy), (x0, y0))

# the wheel: a thick shaded rim, rungs along it, three spokes, a hub
CX, CY, R = 680, 720, 560
ld.ellipse([CX - R, CY - R, CX + R, CY + R], fill=RIM_DK)
ld.ellipse([CX - R + 70, CY - R + 70, CX + R - 70, CY + R - 70], fill=(6, 6, 8))
ld.arc([CX - R + 14, CY - R + 14, CX + R - 14, CY + R - 14], 190, 330, fill=RIM, width=44)
ld.arc([CX - R + 20, CY - R + 20, CX + R - 20, CY + R - 20], 215, 300, fill=RIM_LT, width=18)
for k in range(24):
    a = math.radians(k * 15 + 7)
    x, y = CX + (R - 35) * math.cos(a), CY + (R - 35) * math.sin(a)
    ld.ellipse([x - 16, y - 16, x + 16, y + 16], fill=RUNG)
for k in range(3):
    a = math.radians(k * 120 + 30)
    ld.line([CX, CY, CX + (R - 72) * math.cos(a), CY + (R - 72) * math.sin(a)], fill=RIM, width=26)
ld.ellipse([CX - 54, CY - 54, CX + 54, CY + 54], fill=RIM_LT)
ld.ellipse([CX - 28, CY - 28, CX + 28, CY + 28], fill=HUB)

# Squeektoshi running at the bottom of the drum, facing right: tail, body, belly, head, ear, eye, nose, legs
ld.line([300, 1010, 240, 930], fill=FUR_DK, width=26)
shaded((300, 880, 880, 1150), FUR_LT, FUR_DK, 0.35, 0.3)       # body
shaded((360, 1010, 820, 1150), BELLY, BELLY_DK, 0.4, 0.3)      # belly
shaded((780, 790, 1060, 1070), FUR_LT, FUR_DK, 0.4, 0.3)       # head
shaded((820, 740, 920, 850), FUR_LT, FUR_DK)                   # ear
shaded((840, 770, 900, 830), BELLY, BELLY_DK)                  # inner ear
ld.ellipse([960, 870, 1020, 940], fill=INK)                    # eye
ld.ellipse([975, 882, 995, 902], fill=WHITE)
ld.ellipse([1035, 940, 1070, 975], fill=NOSE)                  # nose
shaded((900, 940, 1040, 1050), BELLY, BELLY_DK, 0.45, 0.3)     # cheek
for (x0, x1) in ((390, 470), (520, 600), (660, 740)):          # legs mid-stride
    ld.rounded_rectangle([x0, 1110, x1, 1180], radius=30, fill=FUR_DK)
im.paste(lay, (0, 0), lay)

# seeds flying off the top of the wheel
d = ImageDraw.Draw(im)
def seed(x, y, s, ang):
    sd = Image.new("RGBA", (s * 2, s * 3), (0, 0, 0, 0))
    g = ImageDraw.Draw(sd)
    g.ellipse([0, 0, s * 2 - 1, s * 3 - 1], fill=SEED)
    g.line([s, s // 2, s, s * 3 - s // 2], fill=SEED_DK, width=max(4, s // 5))
    sd = sd.rotate(ang, expand=True, resample=Image.BICUBIC)
    im.paste(sd, (x, y), sd)
for (x, y, s, ang) in ((1180, 170, 44, 25), (1290, 330, 36, -20), (1100, 60, 30, 60), (1330, 520, 40, 10)):
    seed(x, y, s, ang)

# the wordmark: two heavy lines in the right column
AMBER, CREAM = (255, 196, 80), (248, 242, 228)
f1, f2 = font(425), font(425)
def fit(text, f, x0, x1):
    w = d.textlength(text, font=f)
    return x0 + (x1 - x0 - w) / 2
d.text((fit("WHEEL", f1, 1320, 2530), 350), "WHEEL", font=f1, fill=CREAM)
d.text((fit("MATES", f2, 1320, 2530), 760), "MATES", font=f2, fill=AMBER)

final = im.resize((1280, 720), Image.LANCZOS)
final.save(out / "card-headline.png")
small = final.resize((64, 36), Image.BOX)
small.save(out / "card-64x36.png")
for name, tint in (("orange", (255, 110, 40)), ("blue", (60, 90, 255))):
    pv = Image.new("RGB", (640, 360), (0, 0, 0))
    pd = ImageDraw.Draw(pv)
    for y in range(36):
        for x in range(64):
            r, g, b = small.getpixel((x, y))
            lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255
            v = max(0.06, lum)
            col = tuple(int(t * v) for t in tint) if lum < 0.85 else tuple(min(255, int(t * 0.5 + 128)) for t in tint)
            pd.ellipse([x * 10 + 1, y * 10 + 1, x * 10 + 9, y * 10 + 9], fill=col)
    pv.save(Path(rf"C:/Users/user/.claude/jobs/cba2ae0e/tmp/wm-card-{name}.png"))
print("wrote", out / "card-headline.png")
