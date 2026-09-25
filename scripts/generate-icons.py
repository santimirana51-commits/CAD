#!/usr/bin/env python3
"""Generate PWA icons from public/logo.png (pixelbay CAD)"""
from PIL import Image
import os, sys

SRC = os.path.join(os.path.dirname(__file__), "..", "public", "logo.png")
SRC_FALLBACK = os.path.join(os.path.dirname(__file__), "..", "logo.png")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")

src_path = SRC if os.path.exists(SRC) else SRC_FALLBACK
if not os.path.exists(src_path):
    print(f"ERROR: tidak ada {SRC} atau {SRC_FALLBACK}")
    print("Save gambar pixelbay dari chat ke public/logo.png dulu!")
    sys.exit(1)

os.makedirs(OUT_DIR, exist_ok=True)
im = Image.open(src_path).convert("RGBA")
print(f"Source {src_path}: {im.size}")

def save(icon, size, name, maskable=False):
    if maskable:
        # maskable: 80% safe area + 10% padding each side, bg #1f1f1f
        bg = Image.new("RGBA", (size, size), (31,31,31,255))  # #1f1f1f
        # scale icon to 72% of size (safe)
        inner = int(size * 0.72)
        thumb = icon.copy()
        thumb.thumbnail((inner, inner), Image.NEAREST)  # pixel art: NEAREST
        x = (size - thumb.width)//2
        y = (size - thumb.height)//2
        bg.alpha_composite(thumb, (x,y))
        bg.save(os.path.join(OUT_DIR, name), "PNG")
        print(f"  {name} {size}x{size} maskable")
    else:
        thumb = icon.copy()
        # for non-maskable keep transparent bg, NEAREST for pixel
        thumb = thumb.resize((size, size), Image.NEAREST) if thumb.size != (size,size) else thumb
        # actually proportional: use thumbnail then center on transparent
        bg = Image.new("RGBA", (size, size), (0,0,0,0))
        t = icon.copy()
        t.thumbnail((size, size), Image.NEAREST)
        x = (size - t.width)//2
        y = (size - t.height)//2
        bg.alpha_composite(t, (x,y))
        bg.save(os.path.join(OUT_DIR, name), "PNG")
        print(f"  {name} {size}x{size}")

# also copy to public/logo.png for /logo.png
import shutil
if os.path.abspath(src_path) != os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public", "logo.png")):
    shutil.copy(src_path, os.path.join(os.path.dirname(__file__), "..", "public", "logo.png"))
    print("Copied to public/logo.png")

# Generate 4 icons as per cad.webmanifest
save(im, 192, "cad-192.png", False)
save(im, 512, "cad-512.png", False)
save(im, 192, "cad-maskable-192.png", True)
save(im, 512, "cad-maskable-512.png", True)

# copy also to root for fallback
shutil.copy(os.path.join(OUT_DIR, "cad-192.png"), os.path.join(os.path.dirname(__file__), "..", "logo.png"))
print("Done. Icons in public/icons/")
print("Update cad.webmanifest src sudah /icons/... OK")
