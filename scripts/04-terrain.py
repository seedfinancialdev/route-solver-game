"""The relief layer, built from real elevation data.

Natural Earth's shaded relief is about 1.8 km per pixel, which is fine at
continental scale and mush the moment anyone zooms. This builds the shading
ourselves from AWS Terrain Tiles (the old Mapzen elevation pyramid, metres above
sea level, ~390 m per pixel at these latitudes) reprojected into the game's
conic, so the map holds up when you go looking at how a road crosses a range.

  python3 scripts/04-terrain.py

Downloaded tiles are cached under data/raw/dem/, so a rebuild is free.
"""
import concurrent.futures as futures
import json, math, pathlib, urllib.request
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / 'data' / 'raw' / 'dem'
CACHE.mkdir(parents=True, exist_ok=True)

ZOOM = 7                       # 512 px tiles => ~390 m/px at 50N
TILE = 512
SOURCE = 'https://s3.amazonaws.com/elevation-tiles-prod/geotiff/{z}/{x}/{y}.tif'
# Two renders: an overview that loads instantly and a detail pass swapped in
# behind it once it arrives.
# Three levels. The overview paints instantly, the detail pass covers ordinary
# zooms, and a grid of tiles carries the close work — only the two or three a
# player is actually looking at ever get fetched.
OUTPUTS = [('terrain.webp', 2400, 80), ('terrain-detail.webp', 6000, 68)]
TILE_COLS, TILE_ROWS = 4, 4
TILE_M_PER_PX = 353          # the elevation data's own resolution at these latitudes
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

# Which tiles the view needs. Sample the frame's edge and interior, because a
# conic projection's bounding box in lon/lat is not a rectangle.
gx, gy = np.meshgrid(np.linspace(view['x'], view['x'] + view['w'], 80),
                     np.linspace(view['y'], view['y'] + view['h'], 80))
lon_s, lat_s = inverse(gx, gy)
px_s, py_s = merc_xy(lon_s, lat_s)
x0, x1 = int(px_s.min() // TILE), int(px_s.max() // TILE) + 1
y0, y1 = int(py_s.min() // TILE), int(py_s.max() // TILE) + 1
tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
print(f'view needs {len(tiles)} elevation tiles at zoom {ZOOM} '
      f'(x {x0}-{x1}, y {y0}-{y1})')

missing = [t for t in tiles if not (CACHE / f'{ZOOM}_{t[0]}_{t[1]}.tif').exists()]
if missing:
    print(f'  fetching {len(missing)}...')
    with futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i, _ in enumerate(pool.map(fetch, missing), 1):
            if i % 100 == 0:
                print(f'    {i}/{len(missing)}')

# --- mosaic -----------------------------------------------------------------
width, height = (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE
print(f'mosaic {width} x {height} px')
dem = np.zeros((height, width), dtype=np.int16)
for (x, y) in tiles:
    path = CACHE / f'{ZOOM}_{x}_{y}.tif'
    if not path.exists():
        continue
    with Image.open(path) as im:
        dem[(y - y0) * TILE:(y - y0 + 1) * TILE, (x - x0) * TILE:(x - x0 + 1) * TILE] = \
            np.asarray(im, dtype=np.int32).astype(np.int16)

def render(box, out_w, out_h):
    """Shade one rectangle of the map. Returns a uint8 image."""
    xs = box['x'] + (np.arange(out_w) + 0.5) * box['w'] / out_w
    ys = box['y'] + (np.arange(out_h) + 0.5) * box['h'] / out_h

    # Reproject in horizontal strips so the intermediate float arrays stay small.
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

    # Hillshade, lit from the north-west as every relief map since the 19th
    # century has been, because the eye reads it as raised rather than sunken.
    km_per_px = box['w'] / out_w
    dzdx, dzdy = np.gradient(land, km_per_px * 1000.0)
    azimuth, altitude = math.radians(315.0), math.radians(45.0)
    slope = np.arctan(3.4 * np.hypot(dzdx, dzdy))     # vertical exaggeration
    aspect = np.arctan2(-dzdx, dzdy)
    shade = (math.sin(altitude) * np.cos(slope)
             + math.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect))

    # The page composites this with `mix-blend-mode: overlay`, where mid grey is
    # the do-nothing value: flat ground keeps the land colour and only real
    # relief moves it. A little elevation tint on top so high country reads as
    # high even where it is not steep.
    tint = np.clip(land / 2000.0, 0, 1) ** 0.75
    value = 0.5 + (shade - math.sin(altitude)) * 1.25 + tint * 0.17
    return (np.clip(value, 0, 1) * 255).astype(np.uint8)


for name, out_w, quality in OUTPUTS:
    out_h = round(out_w * view['h'] / view['w'])
    img = render(view, out_w, out_h)
    out = ROOT / 'web' / name
    Image.fromarray(img, mode='L').save(out, 'WEBP', quality=quality, method=5)
    print(f'wrote {out.relative_to(ROOT)}  {out_w}x{out_h}  '
          f'{view["w"] / out_w * 1000:.0f} m/px  {out.stat().st_size / 1024:.0f} KB')

# --- close-work tiles -------------------------------------------------------
tile_dir = ROOT / 'web' / 'terrain'
tile_dir.mkdir(exist_ok=True)
tw, th = view['w'] / TILE_COLS, view['h'] / TILE_ROWS
px_w, px_h = round(tw * 1000 / TILE_M_PER_PX), round(th * 1000 / TILE_M_PER_PX)
manifest, total = [], 0
for row in range(TILE_ROWS):
    for col in range(TILE_COLS):
        box = {'x': view['x'] + col * tw, 'y': view['y'] + row * th, 'w': tw, 'h': th}
        img = render(box, px_w, px_h)
        name = f'{row}_{col}.webp'
        path = tile_dir / name
        Image.fromarray(img, mode='L').save(path, 'WEBP', quality=TILE_QUALITY, method=5)
        total += path.stat().st_size
        manifest.append({'file': f'terrain/{name}', **{k: round(v, 1) for k, v in box.items()}})
(ROOT / 'web' / 'terrain-tiles.json').write_text(json.dumps({
    'metresPerPixel': TILE_M_PER_PX, 'tiles': manifest}))
print(f'wrote {len(manifest)} tiles at {px_w}x{px_h} each, {TILE_M_PER_PX} m/px, '
      f'{total / 1048576:.1f} MB total')
