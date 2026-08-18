"""Phase 4, step 2: the reveal layer.

Natural Earth's shaded relief, reprojected into the same Lambert conformal
conic the boundaries and the adjacency graph use, cropped to the game's view
box. Emitted as a plain grayscale PNG: the page clips it to the country
outlines and tints it in CSS, so one file serves both themes.

  python3 scripts/04-terrain.py
"""
import json, math, pathlib
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_W = 2400

# Must match scripts/lib/proj.mjs.
LAT1, LAT2, LAT0, LON0, R = 43.0, 62.0, 52.0, 15.0, 6371.0088
n = math.log(math.cos(math.radians(LAT1)) / math.cos(math.radians(LAT2))) / math.log(
    math.tan(math.pi / 4 + math.radians(LAT2) / 2) / math.tan(math.pi / 4 + math.radians(LAT1) / 2))
F = math.cos(math.radians(LAT1)) * math.tan(math.pi / 4 + math.radians(LAT1) / 2) ** n / n
RHO0 = R * F / math.tan(math.pi / 4 + math.radians(LAT0) / 2) ** n


def inverse(x, y):
    """Projected km -> (lon, lat) degrees. y points south, as in proj.mjs."""
    rho = np.copysign(np.sqrt(x ** 2 + (RHO0 + y) ** 2), n)
    theta = np.arctan2(x, RHO0 + y)
    lon = LON0 + np.degrees(theta / n)
    lat = np.degrees(2 * np.arctan((R * F / rho) ** (1 / n)) - math.pi / 2)
    return lon, lat


view = json.loads((ROOT / 'data' / 'map.json').read_text())['view']
out_h = round(OUT_W * view['h'] / view['w'])

# Pixel centres of the output image, in projected km.
xs = view['x'] + (np.arange(OUT_W) + 0.5) * view['w'] / OUT_W
ys = view['y'] + (np.arange(out_h) + 0.5) * view['h'] / out_h
lon, lat = inverse(*np.meshgrid(xs, ys))

# Source georeferencing, from SR_HR.tfw.
PX = 1 / 60.0
src_left, src_top = -180.0, 90.0
col = (lon - src_left) / PX - 0.5
row = (src_top - lat) / PX - 0.5

c0, c1 = int(np.floor(col.min())) - 1, int(np.ceil(col.max())) + 2
r0, r1 = int(np.floor(row.min())) - 1, int(np.ceil(row.max())) + 2
print(f'output {OUT_W}x{out_h}, sampling source rows {r0}:{r1} cols {c0}:{c1}')

with Image.open(ROOT / 'data' / 'raw' / 'SR_HR.tif') as im:
    src = np.asarray(im.crop((c0, r0, c1, r1)), dtype=np.float32)

col -= c0
row -= r0
x0 = np.clip(np.floor(col).astype(np.int32), 0, src.shape[1] - 2)
y0 = np.clip(np.floor(row).astype(np.int32), 0, src.shape[0] - 2)
fx = (col - x0).astype(np.float32)
fy = (row - y0).astype(np.float32)
sample = (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x0 + 1] * fx * (1 - fy)
          + src[y0 + 1, x0] * (1 - fx) * fy + src[y0 + 1, x0 + 1] * fx * fy)

# The page composites this with `mix-blend-mode: overlay`, where mid grey is
# the do-nothing value. So flat ground has to land on exactly 128: plains then
# keep the land colour untouched and only real relief modulates it, in both
# directions, the way a hillshade should. Natural Earth's own flat value sits
# well above mid grey, which is why this is a recentre and not a stretch.
land = sample[sample < 250]
flat = np.median(land)
GAIN = 2.3
print(f'relief range {sample.min():.0f}-{sample.max():.0f}, flat ground at {flat:.0f} -> 128')
norm = np.clip(0.5 + (sample - flat) * GAIN / 255.0, 0, 1)

out = ROOT / 'web' / 'terrain.webp'
Image.fromarray((norm * 255).astype(np.uint8), mode='L').save(out, 'WEBP', quality=84, method=6)
print(f'wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB)')
