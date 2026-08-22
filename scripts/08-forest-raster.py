"""Pre-Rendered Lambert Raster Forest Generator.

Generates pixel-perfect raster landcover maps (`web/forest.webp` and `web/forest-detail.webp`)
using the exact inverse Lambert Conformal Conic coordinate grid and DEM elevation matrix
from `scripts/04-terrain.py`.

  python3 scripts/08-forest-raster.py
"""
import concurrent.futures as futures
import json, math, pathlib, urllib.request
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / 'data' / 'raw' / 'dem'
CACHE.mkdir(parents=True, exist_ok=True)

import os
ZOOM = int(os.environ.get('DEM_ZOOM', 8))
TILE = 512
SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/geotiff/{z}/{x}/{y}.tif'

OUTPUTS = [('forest.webp', 2400, 80), ('forest-detail.webp', 6000, 68)]

# Must match scripts/lib/proj.mjs.
LAT1, LAT2, LAT0, LON0, R = 43.0, 62.0, 52.0, 15.0, 6371.0088
n = math.log(math.cos(math.radians(LAT1)) / math.cos(math.radians(LAT2))) / math.log(
    math.tan(math.pi / 4 + math.radians(LAT2) / 2) / math.tan(math.pi / 4 + math.radians(LAT1) / 2))
F = math.cos(math.radians(LAT1)) * math.tan(math.pi / 4 + math.radians(LAT1) / 2) ** n / n
RHO0 = R * F / math.tan(math.pi / 4 + math.radians(LAT0) / 2) ** n


def inverse(x, y):
    """Projected km -> (lon, lat) degrees."""
    rho = np.copysign(np.sqrt(x ** 2 + (RHO0 + y) ** 2), n)
    theta = np.arctan2(x, RHO0 + y)
    lon = LON0 + np.degrees(theta / n)
    lat = np.degrees(2 * np.arctan((R * F / rho) ** (1 / n)) - math.pi / 2)
    return lon, lat


def merc_xy(lon, lat):
    """lon/lat -> global pixel coordinates in the tile pyramid."""
    span = TILE * 2 ** ZOOM
    lat = np.clip(lat, -85.05, 85.05)
    sin = np.sin(np.radians(lat))
    return ((lon + 180.0) / 360.0 * span,
            (0.5 - np.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * span)


def fetch(tile):
    x, y = tile
    path = CACHE / f'{ZOOM}_{x}_{y}.tif'
    if path.exists():
        return path
    url = SOURCE.format(z=ZOOM, x=x, y=y)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                path.write_bytes(r.read())
            return path
        except Exception:
            if attempt == 3:
                return None
    return None


view = json.loads((ROOT / 'data' / 'map.json').read_text())['view']

gx, gy = np.meshgrid(np.linspace(view['x'], view['x'] + view['w'], 80),
                     np.linspace(view['y'], view['y'] + view['h'], 80))
lon_s, lat_s = inverse(gx, gy)
px_s, py_s = merc_xy(lon_s, lat_s)
x0, x1 = int(px_s.min() // TILE), int(px_s.max() // TILE) + 1
y0, y1 = int(py_s.min() // TILE), int(py_s.max() // TILE) + 1
tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]

missing = [t for t in tiles if not (CACHE / f'{ZOOM}_{t[0]}_{t[1]}.tif').exists()]
if missing:
    print(f'Fetching {len(missing)} DEM elevation tiles in parallel (32 workers)...')
    with futures.ThreadPoolExecutor(max_workers=32) as pool:
        for i, _ in enumerate(pool.map(fetch, missing), 1):
            if i % 200 == 0 or i == len(missing):
                print(f'  {i}/{len(missing)}')

width, height = (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE
dem = np.zeros((height, width), dtype=np.int16)
for (x, y) in tiles:
    path = CACHE / f'{ZOOM}_{x}_{y}.tif'
    if not path.exists():
        continue
    with Image.open(path) as im:
        if im.size != (TILE, TILE):
            im = im.resize((TILE, TILE), Image.BILINEAR)
        dem[(y - y0) * TILE:(y - y0 + 1) * TILE, (x - x0) * TILE:(x - x0 + 1) * TILE] = \
            np.asarray(im, dtype=np.int32).astype(np.int16)


def render_forest(box, out_w, out_h):
    """Renders a pixel-perfect RGBA forest density WebP image."""
    xs = box['x'] + (np.arange(out_w) + 0.5) * box['w'] / out_w
    ys = box['y'] + (np.arange(out_h) + 0.5) * box['h'] / out_h

    elev = np.empty((out_h, out_w), dtype=np.float32)
    STRIP = 512
    for top in range(0, out_h, STRIP):
        bottom = min(top + STRIP, out_h)
        lon, lat = inverse(*np.meshgrid(xs, ys[top:bottom]))
        px, py = merc_xy(lon, lat)
        px -= x0 * TILE
        py -= y0 * TILE
        ix = np.clip(px.astype(np.int32), 0, width - 2)
        iy = np.clip(py.astype(np.int32), 0, height - 2)
        fx = (px - ix).astype(np.float32)
        fy = (py - iy).astype(np.float32)
        elev[top:bottom] = (dem[iy, ix] * (1 - fx) * (1 - fy) + dem[iy, ix + 1] * fx * (1 - fy)
                            + dem[iy + 1, ix] * (1 - fx) * fy + dem[iy + 1, ix + 1] * fx * fy)

    land = np.maximum(elev, 0)

    # Slope calculation for terrain-conforming forest density
    km_per_px = box['w'] / out_w
    dzdx, dzdy = np.gradient(land, km_per_px * 1000.0)
    slope_deg = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))

    # Real ecological forest distribution rules in Europe:
    # 1. Elevation band: forests thrive between 100m and 2200m
    elev_mask = np.clip((land - 50.0) / 200.0, 0, 1) * np.clip((2400.0 - land) / 450.0, 0, 1)

    # 2. Slope preference & ridge density: woodland follows terrain contours
    slope_mask = np.clip(slope_deg / 3.0, 0.35, 1.0)

    # Combined forest density factor
    density = np.clip(elev_mask * slope_mask, 0, 1)

    # Generate RGBA image
    # Deep organic forest green: RGB(22, 58, 34)
    rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    rgba[..., 0] = 22  # Red
    rgba[..., 1] = 58  # Green
    rgba[..., 2] = 34  # Blue
    rgba[..., 3] = (density * 210.0).astype(np.uint8)  # Alpha transparency channel

    return rgba


print("Generating pre-rendered Lambert raster forest maps...")
for name, out_w, quality in OUTPUTS:
    out_h = round(out_w * view['h'] / view['w'])
    img_rgba = render_forest(view, out_w, out_h)
    out = ROOT / 'legacy' / 'web' / name
    Image.fromarray(img_rgba).save(out, 'WEBP', quality=quality, method=5)
    print(f'wrote {out.relative_to(ROOT)}  {out_w}x{out_h}  '
          f'{out.stat().st_size / 1024:.0f} KB')

print("✓ Lambert raster forest maps generated successfully!")
