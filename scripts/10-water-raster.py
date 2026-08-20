"""Pre-Rendered Lambert Raster Water Mask Generator.

Generates pixel-perfect raster water maps (`web/water.webp` and `web/water-detail.webp`)
using the exact inverse Lambert Conformal Conic coordinate grid, DEM elevation matrix,
and river corridor geometries.

  python3 scripts/10-water-raster.py
"""
import concurrent.futures as futures
import json, math, pathlib, urllib.request
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / 'data' / 'raw' / 'dem'
CACHE.mkdir(parents=True, exist_ok=True)

import os
ZOOM = int(os.environ.get('DEM_ZOOM', 8))
TILE = 512
SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/geotiff/{z}/{x}/{y}.tif'

OUTPUTS = [('water.webp', 2400, 80), ('water-detail.webp', 6000, 68)]

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
raw_map = json.loads((ROOT / 'web' / 'data.json').read_text())

gx, gy = np.meshgrid(np.linspace(view['x'], view['x'] + view['w'], 80),
                     np.linspace(view['y'], view['y'] + view['h'], 80))
lon_s, lat_s = inverse(gx, gy)
px_s, py_s = merc_xy(lon_s, lat_s)
x0, x1 = int(px_s.min() // TILE), int(px_s.max() // TILE) + 1
y0, y1 = int(py_s.min() // TILE), int(py_s.max() // TILE) + 1
tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]

missing = [t for t in tiles if not (CACHE / f'{ZOOM}_{t[0]}_{t[1]}.tif').exists()]
if missing:
    print(f'Fetching {len(missing)} DEM elevation tiles in parallel...')
    with futures.ThreadPoolExecutor(max_workers=32) as pool:
        for i, _ in enumerate(pool.map(fetch, missing), 1):
            pass

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


def render_water(box, out_w, out_h):
    """Renders a pixel-perfect RGBA water density WebP image."""
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

    # 1. Sea & Ocean Mask (Sea level <= 0m)
    ocean_mask = (elev <= 0.0)

    # 2. Rasterize Lakes & River Corridors onto PIL Canvas
    overlay = Image.new('L', (out_w, out_h), 0)
    draw = ImageDraw.Draw(overlay)

    # Convert map (x, y) km to raster pixel coordinates
    def map_to_px(mx, my):
        px = (mx - box['x']) * (out_w / box['w'])
        py = (my - box['y']) * (out_h / box['h'])
        return px, py

    # Draw Lake Polygons
    if 'lakes' in raw_map:
        for lake_svg in raw_map['lakes']:
            # Parse simple SVG path M...L...
            cmd_pts = []
            tokens = lake_svg.replace('M', ' ').replace('L', ' ').replace('Z', '').strip().split()
            for tok in tokens:
                parts = tok.split()
                for p in parts:
                    coords = p.split()
                    if len(coords) == 2:
                        try:
                            mx, my = float(coords[0]), float(coords[1])
                            cmd_pts.append(map_to_px(mx, my))
                        except ValueError:
                            pass
            if len(cmd_pts) >= 3:
                draw.polygon(cmd_pts, fill=255)

    # Draw River Channels with 2.5px to 5.0px width
    if 'rivers' in raw_map:
        for river_svg in raw_map['rivers']:
            pts = []
            tokens = river_svg.replace('M', ' ').replace('L', ' ').replace('Z', '').split()
            for tok in tokens:
                sub = tok.strip()
                if not sub: continue
                # Match numbers
                import re
                nums = re.findall(r'[-+]?\d*\.\d+|\d+', sub)
                if len(nums) >= 2:
                    for i in range(0, len(nums) - 1, 2):
                        mx, my = float(nums[i]), float(nums[i+1])
                        pts.append(map_to_px(mx, my))

            if len(pts) >= 2:
                stroke_w = max(int(round(3.0 * (out_w / 2400.0))), 2)
                draw.line(pts, fill=255, width=stroke_w)

    river_lake_arr = np.asarray(overlay, dtype=np.float32) / 255.0

    # 3. Combine Ocean Mask + Lakes/Rivers
    combined_water = np.clip(ocean_mask.astype(np.float32) + river_lake_arr, 0, 1)

    # 4. Generate RGBA Water Image
    # Deep Midnight Ocean Blue: RGB(14, 29, 43)
    rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    rgba[..., 0] = 14  # Red
    rgba[..., 1] = 29  # Green
    rgba[..., 2] = 43  # Blue
    rgba[..., 3] = (combined_water * 240.0).astype(np.uint8)

    return rgba


print("Generating pre-rendered Lambert raster water maps...")
for name, out_w, quality in OUTPUTS:
    out_h = round(out_w * view['h'] / view['w'])
    img_rgba = render_water(view, out_w, out_h)
    out = ROOT / 'web' / name
    Image.fromarray(img_rgba).save(out, 'WEBP', quality=quality, method=5)
    print(f'wrote {out.relative_to(ROOT)}  {out_w}x{out_h}  '
          f'{out.stat().st_size / 1024:.0f} KB')

print("✓ Lambert raster water maps generated successfully!")
