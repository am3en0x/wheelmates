"""Draws Wheelmates' pixel art into public/img. Own drawings, hard pixels only (no anti-aliasing): a side-view cage, a
drum wheel on a stand in 12 frames, a tan hamster running (4 frames) and napping, a seed, a chest and six item icons.
Run: python tools/art.py"""
from pathlib import Path
from PIL import Image
import math

OUT = Path(__file__).resolve().parent.parent / "public" / "img"
OUT.mkdir(parents=True, exist_ok=True)

WALL = (28, 26, 34)
WALL_LT = (36, 33, 43)
BAR = (104, 104, 118)
BAR_HI = (150, 150, 166)
BAR_DK = (70, 70, 82)
FLOOR = (52, 40, 28)
BED = (200, 172, 120)
BED_DK = (164, 136, 90)
BED_LT = (226, 204, 158)
FUR = (222, 164, 102)
FUR_DK = (160, 108, 58)
FUR_LT = (244, 210, 164)
OUTLINE = (74, 46, 24)
CREAM = (250, 238, 212)
PINK = (238, 146, 156)
PINK_DK = (190, 100, 112)
EYE = (24, 18, 16)
WHITE = (255, 255, 255)
RIM = (214, 214, 224)
RIM_DK = (132, 132, 148)
RIM_SH = (88, 88, 102)
PLATE = (40, 40, 50)
PLATE_LT = (54, 54, 66)
STAND = (120, 120, 136)
SEED_A = (96, 72, 48)
SEED_B = (240, 228, 196)
SEED_C = (60, 44, 30)
WOOD = (132, 88, 48)
WOOD_DK = (90, 58, 30)
WOOD_LT = (168, 118, 70)
GOLD = (246, 196, 72)
GOLD_DK = (184, 134, 32)
STEEL = (156, 166, 186)
STEEL_DK = (104, 112, 130)
BLUE = (124, 186, 236)
BLUE_LT = (186, 224, 250)


def new(w, h, color=(0, 0, 0, 0)):
    return Image.new("RGBA", (w, h), color)


def px(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((int(x), int(y)), c if len(c) == 4 else c + (255,))


def rect(im, x0, y0, x1, y1, c):
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            px(im, x, y, c)


def disc(im, cx, cy, r, c):
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                px(im, x, y, c)


def ring(im, cx, cy, r_out, r_in, c):
    for y in range(int(cy - r_out) - 1, int(cy + r_out) + 2):
        for x in range(int(cx - r_out) - 1, int(cx + r_out) + 2):
            d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
            if r_in * r_in <= d <= r_out * r_out:
                px(im, x, y, c)


def line(im, x0, y0, x1, y1, c, w=1):
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    for i in range(n + 1):
        t = i / n
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        if w == 1:
            px(im, int(x), int(y), c)
        else:
            disc(im, x, y, w / 2, c)


def outline(im, c):
    """A 1 px outline around every opaque pixel, drawn into the transparent pixels next to it."""
    src = im.copy()
    for y in range(im.height):
        for x in range(im.width):
            if src.getpixel((x, y))[3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < im.width and 0 <= ny < im.height and src.getpixel((nx, ny))[3]:
                    px(im, x, y, c)
                    break


# ---------------------------------------------------------------- the cage, 180 x 180 (drawn at 2x on screen)
def cage():
    im = new(180, 180, WALL + (255,))
    for y in range(0, 150, 2):  # faint wall lines
        rect(im, 0, y, 179, y, WALL_LT)
    for x in range(8, 180, 14):  # bars with a light edge
        rect(im, x, 0, x + 1, 149, BAR)
        rect(im, x, 0, x, 149, BAR_HI)
        rect(im, x + 1, 0, x + 1, 149, BAR_DK)
    rect(im, 0, 0, 179, 3, BAR_DK)  # top rail
    rect(im, 0, 0, 179, 1, BAR_HI)
    rect(im, 0, 150, 179, 179, FLOOR)  # tray
    rect(im, 0, 148, 179, 151, BAR_DK)
    rect(im, 0, 152, 179, 163, BED)
    rect(im, 0, 152, 179, 153, BED_LT)
    for i in range(0, 180, 4):  # bedding
        px(im, i, 155 + (i * 7) % 7, BED_LT)
        px(im, (i + 2) % 180, 157 + (i * 5) % 6, BED_DK)
        px(im, (i + 1) % 180, 160 + (i * 3) % 3, BED_DK)
    rect(im, 0, 164, 179, 179, FLOOR)
    for i in range(0, 180, 9):
        px(im, i, 166 + i % 5, (64, 50, 34))
    # water bottle, hanging on the right bars
    rect(im, 154, 46, 169, 96, STEEL)
    rect(im, 156, 48, 167, 88, BLUE)
    rect(im, 157, 50, 158, 84, BLUE_LT)
    rect(im, 154, 70, 169, 70, STEEL_DK)
    rect(im, 160, 97, 163, 112, STEEL)
    rect(im, 161, 113, 162, 115, STEEL_DK)
    px(im, 161, 116, BLUE_LT)
    rect(im, 150, 52, 153, 53, STEEL_DK)
    rect(im, 150, 88, 153, 89, STEEL_DK)
    # food bowl, left
    rect(im, 10, 146, 36, 153, WOOD)
    rect(im, 9, 146, 37, 147, WOOD_LT)
    rect(im, 12, 142, 34, 146, SEED_B)
    for x in range(13, 34, 3):
        px(im, x, 143, SEED_A)
        px(im, x + 1, 144, SEED_C)
    rect(im, 10, 153, 36, 154, WOOD_DK)
    im.save(OUT / "cage.png")


# ---------------------------------------------------------------- the wheel: a drum on a stand, 12 frames of 30 degrees
def wheel_frames():
    R = 44
    cx = cy = 47.5
    for f in range(12):
        im = new(96, 112)
        rot = f * 2.5  # 12 frames cover one rung spacing of 30 degrees
        # back plate
        disc(im, cx, cy, R - 4, PLATE)
        for y in range(4, 92, 3):
            rect(im, 8, y, 87, y, PLATE_LT) if False else None
        # three thin spokes on the plate, so the turn reads
        for s in range(3):
            a = math.radians(s * 120 + rot * 4)
            line(im, cx, cy, cx + (R - 8) * math.cos(a), cy + (R - 8) * math.sin(a), PLATE_LT, 2)
        # rim: outer light, inner shade
        ring(im, cx, cy, R, R - 3, RIM)
        ring(im, cx, cy, R - 3, R - 5, RIM_DK)
        # rungs: dots just inside the rim every 30 degrees
        for k in range(12):
            a = math.radians(k * 30 + rot * 4)
            x, y = cx + (R - 8) * math.cos(a), cy + (R - 8) * math.sin(a)
            disc(im, x, y, 1.6, RIM)
            px(im, int(x), int(y) + 1, RIM_SH)
        # hub
        disc(im, cx, cy, 5, RIM_DK)
        disc(im, cx, cy, 3, RIM)
        px(im, 47, 47, RIM_SH)
        # stand: an A-frame to the floor behind the drum
        for dx in (-1, 0, 1):
            line(im, cx + dx, cy, 22 + dx, 110, STAND)
            line(im, cx + dx, cy, 73 + dx, 110, STAND)
        rect(im, 16, 108, 79, 111, STAND)
        rect(im, 16, 108, 79, 108, RIM)
        im.save(OUT / f"wheel-{f}.png")


# ---------------------------------------------------------------- the hamster, 48 x 36, facing right
def hamster_body(im, bob):
    y = bob
    disc(im, 22, 20 + y, 13, FUR)  # body
    disc(im, 34, 17 + y, 9, FUR)  # head
    disc(im, 18, 24 + y, 9, FUR)  # rump
    rect(im, 14, 24 + y, 30, 29 + y, CREAM)  # belly
    disc(im, 24, 26 + y, 6, CREAM)
    rect(im, 12, 12 + y, 22, 15 + y, FUR_DK)  # back shade
    rect(im, 10, 16 + y, 14, 19 + y, FUR_DK)
    # ears: 3x3 with pink centres
    rect(im, 30, 7 + y, 32, 9 + y, FUR_DK); px(im, 31, 8 + y, PINK)
    rect(im, 35, 6 + y, 37, 8 + y, FUR_DK); px(im, 36, 7 + y, PINK)
    # eye with a highlight, cheek pouch, nose, whiskers
    rect(im, 37, 14 + y, 38, 15 + y, EYE); px(im, 37, 14 + y, WHITE)
    disc(im, 36, 20 + y, 3, FUR_LT)
    rect(im, 42, 18 + y, 43, 19 + y, PINK)
    px(im, 44, 17 + y, PINK_DK)
    px(im, 44, 20 + y, FUR_DK); px(im, 45, 21 + y, FUR_DK)
    px(im, 44, 16 + y, FUR_DK)
    px(im, 7, 22 + y, FUR_DK); px(im, 6, 21 + y, FUR)  # tail nub


def hamster_run(frame):
    im = new(48, 36)
    bob = [0, 1, 0, 1][frame]
    hamster_body(im, bob)
    y = bob
    # legs: back pair and front pair swing in opposition
    back = [(14, 30, 16, 34), (12, 30, 14, 33), (16, 30, 18, 34), (18, 30, 20, 33)][frame]
    front = [(30, 30, 32, 34), (33, 30, 35, 33), (28, 30, 30, 34), (26, 30, 28, 33)][frame]
    for l in (back, front):
        rect(im, *l, PINK)
        rect(im, l[0], l[1], l[2], l[1], FUR_DK)
    outline(im, OUTLINE)
    im.save(OUT / f"hamster-run-{frame}.png")


def hamster_nap():
    im = new(48, 36)
    disc(im, 22, 24, 13, FUR)
    disc(im, 33, 22, 9, FUR)
    disc(im, 16, 27, 8, FUR)
    rect(im, 14, 29, 30, 33, CREAM)
    rect(im, 12, 16, 22, 19, FUR_DK)
    rect(im, 30, 12, 32, 14, FUR_DK); px(im, 31, 13, PINK)
    rect(im, 35, 11, 37, 13, FUR_DK); px(im, 36, 12, PINK)
    rect(im, 36, 19, 38, 19, EYE)  # closed eye
    disc(im, 35, 25, 3, FUR_LT)
    rect(im, 41, 23, 42, 24, PINK)
    px(im, 7, 26, FUR_DK)
    rect(im, 20, 33, 22, 34, PINK); rect(im, 30, 33, 32, 34, PINK)
    outline(im, OUTLINE)
    im.save(OUT / "hamster-nap.png")


# ---------------------------------------------------------------- small things
def seed():
    im = new(12, 12)
    disc(im, 5.5, 6, 4.5, SEED_A)
    rect(im, 5, 1, 6, 10, SEED_B)
    rect(im, 3, 3, 3, 8, SEED_C)
    rect(im, 8, 3, 8, 8, SEED_C)
    outline(im, SEED_C)
    im.save(OUT / "seed.png")


def chest():
    im = new(28, 22)
    rect(im, 2, 8, 25, 20, WOOD)
    rect(im, 2, 3, 25, 8, WOOD_DK)
    rect(im, 3, 3, 24, 4, WOOD_LT)
    rect(im, 2, 12, 25, 12, WOOD_DK)
    rect(im, 2, 8, 25, 8, GOLD_DK)
    rect(im, 11, 9, 16, 15, GOLD)
    rect(im, 12, 10, 15, 14, GOLD_DK)
    rect(im, 13, 11, 14, 12, GOLD)
    px(im, 13, 13, WOOD_DK); px(im, 14, 13, WOOD_DK)
    for x in (4, 23):
        rect(im, x, 4, x, 19, GOLD_DK)
    outline(im, (50, 32, 16))
    im.save(OUT / "chest.png")


def icons():
    def wheel_icon(im):
        ring(im, 8, 8, 7, 5.2, RIM)
        for k in range(6):
            a = math.radians(k * 60)
            px(im, int(8 + 4 * math.cos(a)), int(8 + 4 * math.sin(a)), RIM)
        rect(im, 7, 7, 8, 8, RIM_DK)

    def bottle(im):
        rect(im, 5, 1, 10, 11, STEEL); rect(im, 6, 2, 9, 9, BLUE); rect(im, 6, 2, 6, 8, BLUE_LT); rect(im, 7, 12, 8, 14, STEEL_DK)

    def bedding(im):
        rect(im, 1, 8, 14, 14, BED); rect(im, 1, 6, 14, 8, BED_DK); rect(im, 1, 8, 14, 8, BED_LT)
        for x in range(2, 14, 3):
            px(im, x, 9 + x % 3, BED_LT); px(im, x + 1, 11 + x % 2, BED_DK)

    def pantry(im):
        rect(im, 2, 3, 13, 13, WOOD); rect(im, 2, 3, 13, 3, WOOD_LT); rect(im, 3, 4, 12, 7, SEED_B)
        for x in range(4, 12, 2):
            px(im, x, 5, SEED_A); px(im, x + 1, 6, SEED_C)

    def stash(im):
        rect(im, 1, 5, 14, 14, WOOD_DK); rect(im, 2, 6, 13, 13, WOOD); rect(im, 6, 2, 9, 5, WOOD_DK); rect(im, 7, 1, 8, 1, WOOD_LT)
        rect(im, 7, 9, 8, 10, GOLD)

    def sneakers(im):
        rect(im, 1, 8, 14, 12, (238, 238, 242)); rect(im, 1, 12, 14, 13, GOLD_DK); rect(im, 8, 5, 13, 8, (238, 238, 242))
        px(im, 10, 6, GOLD_DK); px(im, 12, 6, GOLD_DK); rect(im, 1, 8, 14, 8, (200, 200, 210))

    for name, fn in [("wheel", wheel_icon), ("bottle", bottle), ("bedding", bedding), ("pantry", pantry), ("stash", stash), ("sneakers", sneakers)]:
        im = new(16, 16)
        fn(im)
        im.save(OUT / f"icon-{name}.png")


if __name__ == "__main__":
    for old in OUT.glob("wheel-*.png"):
        old.unlink()
    cage()
    wheel_frames()
    for f in range(4):
        hamster_run(f)
    hamster_nap()
    seed()
    chest()
    icons()
    print("drew", len(list(OUT.glob("*.png"))), "images into", OUT)
