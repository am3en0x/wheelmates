"""Draws the Code Lane headline image: the board shows covers as a 64 x 36 grid of LED dots, so the picture is designed
dot by dot on that grid and exported at 20 px per dot (1280 x 720). Own drawing: a running wheel seen from the side,
Squeektoshi running inside it, speed lines and seeds flying out. Also writes a preview of how the board's dot grid
renders it. Run: python tools/card.py"""
from pathlib import Path
from PIL import Image, ImageDraw

W, H = 64, 36
BG, RING, SPOKE, HUB = (11, 10, 14), (150, 143, 158), (84, 78, 94), (120, 112, 130)
FUR, FUR_DK, BELLY, INK, NOSE = (255, 196, 92), (214, 140, 30), (255, 240, 210), (20, 12, 2), (255, 150, 130)
SEED, SEED_DK, SKIN, SKIN_DK, CUFF = (255, 196, 92), (120, 70, 10), (236, 214, 190), (170, 140, 115), (214, 208, 198)

px = {}
def put(x, y, c):
    if 0 <= x < W and 0 <= y < H: px[(x, y)] = c
def disc(cx, cy, r, c, r_in=-1):
    for y in range(H):
        for x in range(W):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if r_in * r_in < d2 <= r * r + r: put(x, y, c)
def line(x0, y0, x1, y1, c):
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1): put(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), c)
def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): put(x, y, c)

# the wheel: a thick ring with six spokes and a hub, centre (24, 18), outer radius 16
CX, CY = 24, 18
disc(CX, CY, 16, RING, r_in=13.6)
import math
for k in range(6):
    a = math.radians(k * 60 + 15)
    line(CX, CY, round(CX + 13 * math.cos(a)), round(CY + 13 * math.sin(a)), SPOKE)
disc(CX, CY, 2, HUB)

# Squeektoshi running at the bottom of the drum, facing right
rect(16, 24, 28, 29, FUR)          # body
disc(18, 26, 2, FUR)               # rump
rect(17, 29, 27, 30, BELLY)        # belly
disc(29, 24, 3, FUR)               # head
put(29, 20, FUR); put(30, 21, FUR) # ear
put(31, 23, INK)                   # eye
put(32, 25, NOSE)                  # nose
rect(27, 27, 28, 27, BELLY)        # cheek
line(14, 25, 12, 23, FUR_DK)       # tail
put(18, 31, FUR_DK); put(19, 31, FUR_DK); put(24, 31, FUR_DK); put(26, 31, FUR_DK)  # feet
put(22, 30, FUR_DK)

# a hand tapping the wheel from the right, drawn like a cursor: index finger out along the top, three curled fingers
# below it separated by dark rows (off dots on the board), thumb on top, a cuff at the edge
rect(42, 14, 52, 15, SKIN)                 # index finger
put(42, 14, SKIN_DK); put(42, 15, SKIN_DK) # fingertip shade
rect(52, 14, 60, 25, SKIN)                 # fist
for y in (16, 19, 22): rect(52, y, 59, y, BG)        # gaps between the curled fingers
for y in (17, 20, 23): put(52, y, SKIN_DK)           # knuckle shade
rect(54, 11, 57, 13, SKIN); put(54, 13, SKIN_DK)     # thumb
rect(61, 13, 63, 26, CUFF)                 # cuff
# tap ripple at the rim
for (x, y) in ((39, 13), (40, 14), (40, 16), (40, 18), (40, 20), (39, 21)): put(x, y, RING)
# seeds popping out of the wheel
def seed(x, y):
    put(x, y, SEED); put(x + 1, y, SEED); put(x, y + 1, SEED); put(x + 1, y + 1, SEED_DK); put(x + 1, y + 2, SEED); put(x, y + 2, SEED)
    put(x + 1, y - 1, SEED_DK)
for (x, y) in ((40, 3), (45, 7), (34, 1), (48, 27), (43, 30), (53, 29)):
    seed(x, y)

# render
out = Path(__file__).resolve().parent.parent / "docs"
scale = 20
im = Image.new("RGB", (W * scale, H * scale), BG)
d = ImageDraw.Draw(im)
small = Image.new("RGB", (W, H), BG)
for (x, y), c in px.items():
    d.rectangle([x * scale, y * scale, (x + 1) * scale - 1, (y + 1) * scale - 1], fill=c)
    small.putpixel((x, y), c)
im.save(out / "card-headline.png")
small.save(out / "card-64x36.png")
# preview: the board's look, round dots lit by brightness in a blue tint on black
pv = Image.new("RGB", (W * 10, H * 10), (0, 0, 0))
pd = ImageDraw.Draw(pv)
for y in range(H):
    for x in range(W):
        c = px.get((x, y), BG)
        lum = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255
        v = max(0.08, lum)
        col = (int(60 * v), int(90 * v), int(255 * v)) if lum < 0.9 else (int(200 * v), int(215 * v), 255)
        pd.ellipse([x * 10 + 1, y * 10 + 1, x * 10 + 9, y * 10 + 9], fill=col)
pv.save(Path(r"C:/Users/user/.claude/jobs/cba2ae0e/tmp/card-led-preview.png"))
print("wrote", out / "card-headline.png", "and the 64x36 copy; preview in tmp")
