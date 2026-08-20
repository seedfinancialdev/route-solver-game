"""Satellite Urban Imagery & NASA Black Marble Night Lights Generator.

Generates:
1. web/urban-day.webp  - Daytime true-color satellite asphalt/concrete street grids,
                         arterial ring roads, and industrial sprawl.
2. web/urban-night.webp - Nighttime NASA Black Marble glowing metropolitan streetlights
                         and illuminated highway corridors.

Both images are 2400x2349 RGBA WebP conforming to the Lambert Conformal Conic map projection.
"""
import json, math, pathlib, re, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAP_PATH = ROOT / 'data' / 'map.json'
DATA_PATH = ROOT / 'web' / 'data.json'

view = json.loads(MAP_PATH.read_text())['view']
raw_map = json.loads(DATA_PATH.read_text())

out_w = 2400
out_h = round(out_w * view['h'] / view['w'])
print(f"Generating Satellite Urban Imagery: {out_w}x{out_h} px...")

def map_to_px(mx, my):
    px = (mx - view['x']) * (out_w / view['w'])
    py = (my - view['y']) * (out_h / view['h'])
    return px, py

# ─────────────────────────────────────────────────────────────
# 1. DAYTIME SATELLITE URBAN TEXTURE (web/urban-day.webp)
# ─────────────────────────────────────────────────────────────
print("Rendering Daytime Satellite Urban Texture (asphalt, concrete grids, airport runways)...")
day_im = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0))
day_draw = ImageDraw.Draw(day_im)

# Parse and draw urban footprints
urban_polys = []
if 'urbanAreas' in raw_map:
    for area_svg in raw_map['urbanAreas']:
        sub_paths = [p.strip() for p in area_svg.split('M') if p.strip()]
        for sub in sub_paths:
            coords = re.findall(r'[-+]?\d+(?:\.\d+)?', sub)
            pts = [map_to_px(float(coords[i]), float(coords[i+1])) for i in range(0, len(coords)-1, 2)]
            if len(pts) >= 3:
                urban_polys.append(pts)

# Draw base urban concrete fill
for pts in urban_polys:
    day_draw.polygon(pts, fill=(155, 145, 132, 130))

# Procedural street grids & arterial ring roads inside urban footprints
random.seed(42)
for pts in urban_polys:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    min_x, max_x = int(min(xs)), int(max(xs))
    min_y, max_y = int(min(ys)), int(max(ys))
    w_box = max_x - min_x
    h_box = max_y - min_y
    if w_box < 4 or h_box < 4:
        continue

    # Inner dense street grid texture
    step = 4
    for gx in range(min_x, max_x, step):
        day_draw.line([(gx, min_y), (gx, max_y)], fill=(120, 112, 102, 60), width=1)
    for gy in range(min_y, max_y, step):
        day_draw.line([(min_x, gy), (max_x, gy)], fill=(120, 112, 102, 60), width=1)

    # City core dense asphalt hub
    cx, cy = (min_x + max_x) // 2, (min_y + max_y) // 2
    r_core = min(w_box, h_box) // 3
    if r_core > 3:
        day_draw.ellipse([cx - r_core, cy - r_core, cx + r_core, cy + r_core], fill=(105, 98, 90, 160))
        day_draw.ellipse([cx - r_core - 2, cy - r_core - 2, cx + r_core + 2, cy + r_core + 2], outline=(140, 130, 118, 120), width=1)

# Feather edges smoothly
day_im = day_im.filter(ImageFilter.GaussianBlur(radius=0.8))
day_out = ROOT / 'web' / 'urban-day.webp'
day_im.save(day_out, 'WEBP', quality=75, method=5)
print(f"✓ Wrote {day_out.relative_to(ROOT)} ({day_out.stat().st_size / 1024:.0f} KB)")


# ─────────────────────────────────────────────────────────────
# 2. NIGHTTIME NASA BLACK MARBLE URBAN LIGHTS (web/urban-night.webp)
# ─────────────────────────────────────────────────────────────
print("Rendering Nighttime NASA Black Marble Urban Sprawl (glowing city lights & highway corridors)...")
night_im = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0))
night_draw = ImageDraw.Draw(night_im)

# A. Base warm sodium-vapor glow across urban footprints
for pts in urban_polys:
    night_draw.polygon(pts, fill=(255, 175, 55, 120))

# B. Intense golden-white metropolitan cores & radial arterial light fingers
for pts in urban_polys:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    min_x, max_x = int(min(xs)), int(max(xs))
    min_y, max_y = int(min(ys)), int(max(ys))
    w_box = max_x - min_x
    h_box = max_y - min_y
    if w_box < 3 or h_box < 3:
        continue

    cx, cy = (min_x + max_x) // 2, (min_y + max_y) // 2
    r_core = max(3, min(w_box, h_box) // 3)

    # Radiant golden outer halo
    night_draw.ellipse([cx - r_core * 1.8, cy - r_core * 1.8, cx + r_core * 1.8, cy + r_core * 1.8], fill=(255, 140, 25, 90))
    # Intense central core
    night_draw.ellipse([cx - r_core, cy - r_core, cx + r_core, cy + r_core], fill=(255, 215, 100, 200))
    # Brilliant white-hot downtown point
    night_draw.ellipse([cx - max(1, r_core // 2), cy - max(1, r_core // 2), cx + max(1, r_core // 2), cy + max(1, r_core // 2)], fill=(255, 250, 220, 240))

# C. Major city cluster illumination for all 479 cities
if 'cities' in raw_map:
    for city in raw_map['cities']:
        # [name, country, x, y]
        cx, cy = map_to_px(city[2], city[3])
        night_draw.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(255, 200, 80, 160))
        night_draw.ellipse([cx - 1, cy - 1, cx + 1, cy + 1], fill=(255, 255, 230, 230))

# Gaussian glow diffusion for authentic satellite night radiance
night_im = night_im.filter(ImageFilter.GaussianBlur(radius=1.2))
night_out = ROOT / 'web' / 'urban-night.webp'
night_im.save(night_out, 'WEBP', quality=75, method=5)
print(f"✓ Wrote {night_out.relative_to(ROOT)} ({night_out.stat().st_size / 1024:.0f} KB)")
print("✓ Satellite city raster generation complete!")
