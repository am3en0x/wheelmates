"""Draws the Code Lane headline image: the board shows covers as a 64 x 36 grid of LED dots, so the picture is designed
dot by dot on that grid and exported at 20 px per dot (1280 x 720). Own drawing: a running wheel seen from the side
with Squeektoshi running inside it, plus one of several right-hand motifs. Also writes a preview of how the board's dot
grid renders it. Run: python tools/card.py [mates|arcs|x2|chest|hand] (the board uses mates)"""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw

W, H = 64, 36
BG, RING, SPOKE, HUB = (11, 10, 14), (150, 143, 158), (84, 78, 94), (120, 112, 130)
FUR, FUR_DK, BELLY, INK, NOSE = (255, 196, 92), (214, 140, 30), (255, 240, 210), (20, 12, 2), (255, 150, 130)
SEED, SEED_DK = (255, 196, 92), (120, 70, 10)
SKIN, SKIN_DK, CUFF = (236, 214, 190), (170, 140, 115), (214, 208, 198)
WOOD, WOOD_DK, BRASS, GLOW = (176, 112, 60), (110, 66, 30), (255, 230, 150), (255, 240, 210)

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
def arc(cx, cy, r, a0, a1, c):
    for k in range(int((a1 - a0) * 4) + 1):
        a = math.radians(a0 + k / 4)
        put(round(cx + r * math.cos(a)), round(cy + r * math.sin(a)), c)
def seed(x, y):
    put(x, y, SEED); put(x + 1, y, SEED); put(x, y + 1, SEED); put(x + 1, y + 1, SEED_DK); put(x + 1, y + 2, SEED); put(x, y + 2, SEED)
    put(x + 1, y - 1, SEED_DK)
def glyph(rows, x0, y0, c, s=2):  # a bitmap glyph scaled by s
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '#': rect(x0 + i * s, y0 + j * s, x0 + i * s + s - 1, y0 + j * s + s - 1, c)

CX, CY = 24, 18
def wheel():
    disc(CX, CY, 16, RING, r_in=13.6)
    for k in range(6):
        a = math.radians(k * 60 + 15)
        line(CX, CY, round(CX + 13 * math.cos(a)), round(CY + 13 * math.sin(a)), SPOKE)
    disc(CX, CY, 2, HUB)
    # Squeektoshi running at the bottom of the drum, facing right
    rect(16, 24, 28, 29, FUR); disc(18, 26, 2, FUR); rect(17, 29, 27, 30, BELLY)
    disc(29, 24, 3, FUR); put(29, 20, FUR); put(30, 21, FUR)
    put(31, 23, INK); put(32, 25, NOSE); rect(27, 27, 28, 27, BELLY)
    line(14, 25, 12, 23, FUR_DK)
    for x in (18, 19, 24, 26): put(x, 31, FUR_DK)
    put(22, 30, FUR_DK)

def motif_hand():
    rect(42, 14, 52, 15, SKIN); put(42, 14, SKIN_DK); put(42, 15, SKIN_DK)
    rect(52, 14, 60, 25, SKIN)
    for y in (16, 19, 22): rect(52, y, 59, y, BG)
    for y in (17, 20, 23): put(52, y, SKIN_DK)
    rect(54, 11, 57, 13, SKIN); put(54, 13, SKIN_DK)
    rect(61, 13, 63, 26, CUFF)
    for (x, y) in ((40, 3), (45, 7), (34, 1), (48, 27), (43, 30), (53, 29)): seed(x, y)

def motif_arcs():
    # the wheel is spinning: three motion arcs off the right of the rim, seeds thrown off along the top
    arc(CX, CY, 19, -38, 38, RING)
    arc(CX, CY, 22.5, -30, 30, SPOKE)
    arc(CX, CY, 26, -20, 20, SPOKE)
    for (x, y) in ((36, 0), (41, 2), (46, 5), (50, 9), (53, 14), (54, 20), (52, 26), (48, 30), (58, 30)): seed(x, y)

def motif_x2():
    # the live multiplier: a big x2 with a bolt, seeds around
    X = ['#...#', '.#.#.', '..#..', '.#.#.', '#...#']
    TWO = ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####']
    glyph(X, 41, 14, GLOW, 2)
    glyph(TWO, 52, 10, GLOW, 2)
    # a small bolt above
    for (x, y) in ((47, 3), (46, 4), (45, 5), (46, 6), (47, 6), (46, 7), (45, 8), (44, 9)): put(x, y, SEED)
    for (x, y) in ((40, 28), (46, 30), (54, 28), (60, 30), (60, 4), (56, 1)): seed(x, y)

def motif_chest():
    # a block chest just opened, seeds bursting out of it
    rect(44, 20, 61, 31, WOOD)                 # body
    rect(44, 20, 61, 20, WOOD_DK); rect(44, 31, 61, 31, WOOD_DK)
    for x in (46, 59): rect(x, 21, x, 30, WOOD_DK)   # straps
    rect(51, 23, 54, 26, BRASS); put(52, 25, WOOD_DK); put(53, 25, WOOD_DK)  # lock
    rect(43, 16, 62, 17, WOOD_DK)              # open lid, seen edge-on
    rect(44, 15, 61, 15, WOOD)
    # the burst
    for (x, y) in ((45, 9), (50, 5), (56, 7), (60, 11), (48, 12), (53, 10)): seed(x, y)
    for (x, y) in ((42, 13), (47, 2), (58, 3), (63, 8), (40, 7)): put(x, y, GLOW)

def motif_mates():
    # wheelmates: three hamster faces watching from the right, eyes as dark holes so the board shows them as off dots
    FACE = [".##.....##.", ".###...###.", "..#######..", ".#########.", ".#E#####E#.", ".#########.",
            "#CC##N##CC#", "#CC#####CC#", ".#########.", "..#######.."]
    def face(x0, y0):
        for j, row in enumerate(FACE):
            for i, ch in enumerate(row):
                c = {'#': FUR, 'E': INK, 'C': BELLY, 'N': NOSE}.get(ch)
                if c: put(x0 + i, y0 + j, c)
    face(41, 2); face(52, 13); face(42, 24)
    for (x, y) in ((54, 2), (60, 6), (41, 16), (60, 26), (56, 31)): seed(x, y)

MOTIFS = {'arcs': motif_arcs, 'x2': motif_x2, 'chest': motif_chest, 'mates': motif_mates, 'hand': motif_hand}

def render(variant, out_dir, preview_path=None):
    px.clear()
    wheel()
    MOTIFS[variant]()
    scale = 20
    im = Image.new("RGB", (W * scale, H * scale), BG)
    d = ImageDraw.Draw(im)
    small = Image.new("RGB", (W, H), BG)
    for (x, y), c in px.items():
        d.rectangle([x * scale, y * scale, (x + 1) * scale - 1, (y + 1) * scale - 1], fill=c)
        small.putpixel((x, y), c)
    pv = Image.new("RGB", (W * 10, H * 10), (0, 0, 0))
    pd = ImageDraw.Draw(pv)
    for y in range(H):
        for x in range(W):
            c = px.get((x, y), BG)
            lum = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255
            v = max(0.08, lum)
            col = (int(60 * v), int(90 * v), int(255 * v)) if lum < 0.9 else (int(200 * v), int(215 * v), 255)
            pd.ellipse([x * 10 + 1, y * 10 + 1, x * 10 + 9, y * 10 + 9], fill=col)
    return im, small, pv

if __name__ == "__main__":
    variant = sys.argv[1] if len(sys.argv) > 1 else 'mates'
    out = Path(__file__).resolve().parent.parent / "docs"
    im, small, pv = render(variant, out)
    im.save(out / "card-headline.png"); small.save(out / "card-64x36.png")
    print("wrote", out / "card-headline.png", "variant", variant)
