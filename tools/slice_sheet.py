#!/usr/bin/env python3
"""Cut a generated sprite sheet into single, equally framed sprites.

    python3 tools/slice_sheet.py assets/raw/faces_idle.webp --grid 3x2 \
        --names orange,blue,yellow,pink,green,lavender \
        --out assets/img/faces --prefix idle- --frame 510

Items are found by scanning for empty gaps between them, so the sheet does not
need a perfect grid. --fit picks how each item lands in its square sprite:
  sheet    one shared frame sized to the largest item, so variants of the same
           thing (colors, expressions) keep their relative size (default)
  item     each item gets its own frame, for unrelated stickers of mixed shapes
  stretch  each item is scaled to fill the square exactly, for board tiles
  trim     each item keeps its own aspect ratio, longest side = --size but never
           enlarged, for decorations placed freely (leaves, banners)
Use --key ff00ff for sheets that came back with a flat magenta background.
"""
import argparse
import os

import numpy as np
from PIL import Image

ALPHA_MIN = 16  # ignore near-invisible antialiasing noise when finding items


def key_out(img, hex_color, tolerance=90):
    """Make a flat background color transparent, softening the edge."""
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32)
    key = np.array([int(hex_color[i:i + 2], 16) for i in (0, 2, 4)], np.float32)
    dist = np.linalg.norm(rgba[..., :3] - key, axis=-1)
    alpha = np.clip((dist - tolerance * 0.5) / (tolerance * 0.5), 0, 1)
    rgba[..., 3] *= alpha
    return Image.fromarray(rgba.astype(np.uint8), "RGBA")


def runs(mask, min_len):
    """Return (start, end) spans where mask is True, dropping tiny specks."""
    spans, start = [], None
    for i, on in enumerate(mask):
        if on and start is None:
            start = i
        elif not on and start is not None:
            spans.append((start, i))
            start = None
    if start is not None:
        spans.append((start, len(mask)))
    return [s for s in spans if s[1] - s[0] >= min_len]


def find_cells(alpha, cols, rows):
    """Split the sheet at empty gaps; fall back to an even grid if that fails."""
    solid = alpha > ALPHA_MIN
    h, w = solid.shape
    xs = runs(solid.any(axis=0), w // (cols * 8))
    ys = runs(solid.any(axis=1), h // (rows * 8))
    if len(xs) != cols:
        xs = [(w * i // cols, w * (i + 1) // cols) for i in range(cols)]
    if len(ys) != rows:
        ys = [(h * i // rows, h * (i + 1) // rows) for i in range(rows)]
    return [(x0, y0, x1, y1) for (y0, y1) in ys for (x0, x1) in xs]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("sheet")
    p.add_argument("--grid", required=True, help="COLSxROWS, e.g. 3x2")
    p.add_argument("--names", required=True, help="comma-separated, row by row")
    p.add_argument("--out", required=True)
    p.add_argument("--prefix", default="")
    p.add_argument("--size", type=int, default=256, help="output size in px (square, or longest side for trim)")
    p.add_argument("--pad", type=float, default=0.04, help="empty margin, fraction of frame")
    p.add_argument("--fit", choices=("sheet", "item", "stretch", "trim"), default="sheet")
    p.add_argument("--frame", type=int, help="fixed frame side in sheet px for --fit sheet; use the "
                   "same value for sheets whose sprites swap (e.g. face expressions) so they share one scale")
    p.add_argument("--key", help="hex background color to remove, e.g. ff00ff")
    p.add_argument("--format", choices=("webp", "png"), default="webp")
    args = p.parse_args()

    cols, rows = (int(n) for n in args.grid.lower().split("x"))
    names = args.names.split(",")
    if len(names) != cols * rows:
        p.error(f"--names has {len(names)} entries, grid needs {cols * rows}")

    img = Image.open(args.sheet).convert("RGBA")
    if args.key:
        img = key_out(img, args.key.lstrip("#"))
    alpha = np.asarray(img.getchannel("A"))

    items = []
    for box in find_cells(alpha, cols, rows):
        cell = img.crop(box)
        bbox = Image.fromarray((np.asarray(cell.getchannel("A")) > ALPHA_MIN).astype(np.uint8) * 255).getbbox()
        if bbox is None:
            p.error(f"empty cell at {box}")
        items.append(cell.crop(bbox))

    largest = max(max(i.size) for i in items)
    frame = args.frame or int(largest * (1 + 2 * args.pad))
    if frame < largest:
        p.error(f"--frame {frame} is smaller than the largest item ({largest}px)")
    os.makedirs(args.out, exist_ok=True)
    for name, item in zip(names, items):
        if args.fit == "stretch":
            canvas = item.resize((args.size, args.size), Image.LANCZOS)
        elif args.fit == "trim":
            m = int(max(item.size) * args.pad)
            canvas = Image.new("RGBA", (item.width + 2 * m, item.height + 2 * m), (0, 0, 0, 0))
            canvas.paste(item, (m, m))
            scale = min(1, args.size / max(canvas.size))
            canvas = canvas.resize((round(canvas.width * scale), round(canvas.height * scale)), Image.LANCZOS)
        else:
            side = frame if args.fit == "sheet" else int(max(item.size) * (1 + 2 * args.pad))
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(item, ((side - item.width) // 2, (side - item.height) // 2))
            canvas = canvas.resize((args.size, args.size), Image.LANCZOS)
        path = os.path.join(args.out, f"{args.prefix}{name}.{args.format}")
        if args.format == "webp":
            canvas.save(path, quality=90, method=6, exact=False)
        else:
            canvas.save(path, optimize=True)
        print(f"{path}  ({item.width}x{item.height} in sheet)")


if __name__ == "__main__":
    main()
