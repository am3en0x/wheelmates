"""Draws Wheelmates' pixel art into web/img. Own drawings: a side-view cage, a wheel in 8 frames, a tan hamster running
(4 frames) and napping, a seed, a chest and six item icons. Run: python tools/art.py"""
from pathlib import Path
from PIL import Image, ImageDraw
import math

OUT = Path(__file__).resolve().parent.parent / "web" / "img"
OUT.mkdir(parents=True, exist_ok=True)

BG = (13, 13, 18)
WALL = (26, 26, 34)
BAR = (92, 92, 106)
BAR_HI = (130, 130, 146)
FLOOR = (46, 36, 26)
BED = (196, 170, 122)
BED_DK = (160, 136, 94)
BED_LT = (222, 200, 156)
FUR = (217, 160, 102)
FUR_DK = (170, 118, 66)
FUR_LT = (240, 206, 160)
CREAM = (246, 234, 206)
PINK = (236, 140, 150)
EYE = (20, 16, 14)
RIM = (201, 201, 212)
RIM_DK = (120, 120, 134)
SPOKE = (160, 160, 172)
ORANGE = (246, 166, 59)
SEED_A = (90, 70, 50)
SEED_B = (236, 226, 196)
WOOD = (120, 80, 44)
WOOD_DK = (84, 54, 28)
GOLD = (236, 190, 70)
STEEL = (150, 160, 180)
BLUE = (120, 180, 230)
GREEN = (110, 180, 110)


def new(w, h, color=(0, 0, 0, 0)):
    return Image.new("RGBA", (w, h), color)


def px(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((x, y), c if len(c) == 4 else c + (255,))


def rect(im, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(im, x, y, c)


def cage():
    im = new(180, 120, BG + (255,))
    rect(im, 0, 0, 179, 99, WALL)
    for x in range(6, 180, 12):  # bars
        rect(im, x, 0, x, 99, BAR)
        px(im, x + 1, 0, BAR_HI)
        for y in range(0, 100, 7):
            px(im, x, y, BAR_HI)
    rect(im, 0, 100, 179, 119, FLOOR)
    rect(im, 0, 100, 179, 103, BED_DK)
    rect(im, 0, 104, 179, 112, BED)
    for i in range(0, 180, 5):  # bedding texture
        px(im, i, 104 + (i * 7) % 8, BED_LT)
        px(im, (i + 3) % 180, 106 + (i * 3) % 6, BED_DK)
    # water bottle on the right
    rect(im, 158, 40, 170, 78, STEEL)
    rect(im, 160, 42, 168, 70, BLUE)
    rect(im, 163, 79, 165, 90, STEEL)
    px(im, 164, 91, BLUE)
    # food bowl on the left
    rect(im, 10, 96, 30, 103, WOOD)
    rect(im, 12, 94, 28, 96, SEED_B)
    for x in range(13, 28, 3):
        px(im, x, 94, SEED_A)
    im.save(OUT / "cage.png")


def wheel_frames():
    for f in range(8):
        im = new(64, 64)
        d = ImageDraw.Draw(im)
        cx = cy = 31.5
        d.ellipse((4, 4, 59, 59), outline=RIM, width=3)
        d.ellipse((8, 8, 55, 55), outline=RIM_DK, width=1)
        for s in range(6):
            a = math.radians(s * 60 + f * 7.5)
            d.line((cx, cy, cx + 25 * math.cos(a), cy + 25 * math.sin(a)), fill=SPOKE, width=2)
        d.ellipse((27, 27, 36, 36), fill=ORANGE)
        d.ellipse((30, 30, 33, 33), fill=RIM)
        im.save(OUT / f"wheel-{f}.png")


def hamster_run(frame):
    im = new(32, 24)
    # body: a plump ellipse, head to the right
    body = [(6, 10, 25, 20), (6, 11, 25, 21), (6, 9, 25, 19), (6, 11, 25, 21)][frame]
    ImageDraw.Draw(im).ellipse(body, fill=FUR)
    ImageDraw.Draw(im).ellipse((20, 8, 29, 17), fill=FUR)  # head
    rect(im, 10, 16, 20, 19, CREAM)  # belly
    rect(im, 8, 11, 12, 13, FUR_DK)  # back shade
    px(im, 23, 7, FUR_DK); px(im, 24, 6, FUR); px(im, 22, 8, PINK)  # ear
    px(im, 26, 11, EYE); px(im, 27, 11, EYE)
    px(im, 29, 13, PINK)  # nose
    px(im, 24, 14, FUR_LT); px(im, 25, 14, FUR_LT)  # cheek
    # legs alternate
    legs = [((10, 20, 11, 22), (18, 20, 19, 22)), ((9, 20, 10, 23), (19, 20, 20, 21)), ((11, 20, 12, 21), (17, 20, 18, 23)), ((12, 20, 13, 22), (16, 20, 17, 22))][frame]
    for l in legs:
        rect(im, *l, PINK)
    px(im, 5, 12, FUR_DK)  # tail nub
    im.save(OUT / f"hamster-run-{frame}.png")


def hamster_nap():
    im = new(32, 24)
    ImageDraw.Draw(im).ellipse((6, 9, 27, 22), fill=FUR)
    rect(im, 10, 17, 22, 20, CREAM)
    rect(im, 8, 11, 14, 13, FUR_DK)
    px(im, 23, 8, FUR_DK); px(im, 22, 9, PINK)
    rect(im, 24, 13, 26, 13, EYE)  # closed eye
    px(im, 28, 15, PINK)
    for i, (x, y) in enumerate([(29, 6), (30, 3), (31, 0)]):
        px(im, x, y, (160, 170, 210))
    im.save(OUT / "hamster-nap.png")


def seed():
    im = new(8, 8)
    ImageDraw.Draw(im).ellipse((1, 0, 6, 7), fill=SEED_A)
    rect(im, 3, 1, 4, 6, SEED_B)
    im.save(OUT / "seed.png")


def chest():
    im = new(20, 16)
    rect(im, 1, 5, 18, 14, WOOD)
    rect(im, 1, 2, 18, 5, WOOD_DK)
    rect(im, 1, 9, 18, 9, WOOD_DK)
    rect(im, 8, 7, 11, 11, GOLD)
    px(im, 9, 9, WOOD_DK); px(im, 10, 9, WOOD_DK)
    im.save(OUT / "chest.png")


def icons():
    def wheel_icon(im):
        ImageDraw.Draw(im).ellipse((1, 1, 14, 14), outline=RIM, width=2)
        rect(im, 7, 7, 8, 8, ORANGE)
    def bottle(im):
        rect(im, 5, 1, 10, 11, STEEL); rect(im, 6, 2, 9, 9, BLUE); rect(im, 7, 12, 8, 14, STEEL)
    def bedding(im):
        rect(im, 1, 8, 14, 14, BED); rect(im, 1, 6, 14, 8, BED_DK)
        for x in range(2, 14, 3): px(im, x, 9 + x % 3, BED_LT)
    def pantry(im):
        rect(im, 2, 2, 13, 13, WOOD); rect(im, 3, 3, 12, 7, SEED_B)
        for x in range(4, 12, 2): px(im, x, 5, SEED_A)
    def stash(im):
        rect(im, 1, 4, 14, 14, WOOD_DK); rect(im, 2, 5, 13, 13, WOOD); rect(im, 6, 1, 9, 4, WOOD_DK)
        px(im, 7, 9, GOLD); px(im, 8, 9, GOLD)
    def sneakers(im):
        rect(im, 1, 8, 14, 12, (236, 236, 240)); rect(im, 1, 12, 14, 13, ORANGE); rect(im, 8, 5, 13, 8, (236, 236, 240))
        px(im, 10, 6, ORANGE); px(im, 12, 6, ORANGE)
    for name, fn in [("wheel", wheel_icon), ("bottle", bottle), ("bedding", bedding), ("pantry", pantry), ("stash", stash), ("sneakers", sneakers)]:
        im = new(16, 16)
        fn(im)
        im.save(OUT / f"icon-{name}.png")


if __name__ == "__main__":
    cage()
    wheel_frames()
    for f in range(4):
        hamster_run(f)
    hamster_nap()
    seed()
    chest()
    icons()
    print("drew", len(list(OUT.glob("*.png"))), "images into", OUT)
