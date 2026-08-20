"""The relief layer, built from real elevation data with landmass masking.

Builds shaded relief from DEM elevation tiles reprojected into the game's conic,
clipped to landmass polygons so oceans and seas remain 100% transparent (alpha = 0).

  python3 scripts/04-terrain.py
"""
import concurrent.futures as futures
import json, math, pathlib, re, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / 'data' / 'raw' / 'dem'
CACHE.mkdir(parents=True, exist_ok=True)

import os
ZOOM = int(os.environ.get('DEM_ZOOM', 8))   # 512 px tiles => ~195 m/px at 50N at z8
TILE = 512
SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/geotiff/{z}/{x}/{y}.tif'

OUTPUTS = [('terrain.webp', 2400, 80), ('terrain-detail.webp', 6000, 68)]
TILE_COLS, TILE_ROWS = int(os.environ.get('TILE_GRID', 6)), int(os.environ.get('TILE_GRID', 6))
TILE_M_PER_PX = int(os.environ.get('TILE_M_PER_PX', 195))
TILE_QUALITY = 62

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


def build_land_mask(box, out_w, out_h):
    """Rasterizes all 65 country polygons into an 8-bit mask (255 on land, 0 on sea)."""
    overlay = Image.new('L', (out_w, out_h), 0)
    draw = ImageDraw.Draw(overlay)

    def map_to_px(mx, my):
        px = (mx - box['x']) * (out_w / box['w'])
        py = (my - box['y']) * (out_h / box['h'])
        return px, py

    if 'countries' in raw_map:
        for country_svg in raw_map['countries']:
            sub_paths = [p.strip() for p in country_svg.split('M') if p.strip()]
            for sub in sub_paths:
                coords = re.findall(r'[-+]?\d+(?:\.\d+)?', sub)
                pts = [map_to_px(float(coords[i]), float(coords[i+1])) for i in range(0, len(coords)-1, 2)]
                if len(pts) >= 3:
                    draw.polygon(pts, fill=255)

    # Slight edge feathering on coastlines
    blur_r = max(float(0.8 * (out_w / 2400.0)), 0.5)
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=blur_r))
    return np.asarray(overlay, dtype=np.uint8)


def render(box, out_w, out_h):
    """Renders land-masked RGBA elevation hillshade relief."""
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

    # Hillshade computation
    km_per_px = box['w'] / out_w
    dzdx, dzdy = np.gradient(land, km_per_px * 1000.0)
    azimuth, altitude = math.radians(315.0), math.radians(45.0)
    slope = np.arctan(3.4 * np.hypot(dzdx, dzdy))     # vertical exaggeration
    aspect = np.arctan2(-dzdx, dzdy)
    shade = (math.sin(altitude) * np.cos(slope)
             + math.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect))

    tint = np.clip(land / 2000.0, 0, 1) ** 0.75
    value = 0.5 + (shade - math.sin(altitude)) * 1.25 + tint * 0.17
    shade_u8 = (np.clip(value, 0, 1) * 255).astype(np.uint8)

    # Land mask for ocean transparency
    land_mask = build_land_mask(box, out_w, out_h)

    # RGBA image assembly
    rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    rgba[..., 0] = shade_u8  # Red
    rgba[..., 1] = shade_u8  # Green
    rgba[..., 2] = shade_u8  # Blue
    rgba[..., 3] = land_mask  # Alpha (255 on land, 0 on ocean/sea)

    return rgba


print("Generating land-masked RGBA terrain elevation relief maps...")
for name, out_w, quality in OUTPUTS:
    out_h = round(out_w * view['h'] / view['w'])
    img = render(view, out_w, out_h)
    out = ROOT / 'web' / name
    Image.fromarray(img).save(out, 'WEBP', quality=quality, method=5)
    print(f'wrote {out.relative_to(ROOT)}  {out_w}x{out_h}  '
          f'{out.stat().st_size / 1024:.0f} KB')

# Close-work fine tiles
tile_dir = ROOT / 'web' / 'terrain'
tile_dir.mkdir(exist_ok=True)
tw, th = view['w'] / TILE_COLS, view['h'] / TILE_ROWS
px_w, px_h = round(tw * 1000 / TILE_M_PER_PX), round(th * 1000 / TILE_M_PER_PX)
for row in range(TILE_ROWS):
    for col in range(TILE_COLS):
        box = {'x': view['x'] + col * tw, 'y': view['y'] + row * th, 'w': tw, 'h': th}
        img = render(box, px_w, px_h)
        name = f'{row}_{col}.webp'
        path = tile_dir / name
        Image.fromarray(img).save(path, 'WEBP', quality=TILE_QUALITY, method=5)

print("✓ Land-masked terrain elevation relief generated successfully!")
