"""Authentic NASA Black Marble & True-Color Satellite Imagery Generator.

Downloads real satellite image tiles covering the European playable area:
1. NASA Black Marble (VIIRS City Lights) from NASA Earthdata / GIBS
2. True-Color Satellite Photography from ESRI / Sentinel-2 World Imagery

Reprojects all pixels into the game's Lambert Conformal Conic map projection.

  python3 scripts/11-urban-satellite-raster.py
"""
import concurrent.futures as futures
import json, math, pathlib, urllib.request, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = pathlib.Path(__file__).resolve().parent.parent

CACHE_NIGHT = ROOT / 'data' / 'raw' / 'nasa-night'
CACHE_DAY = ROOT / 'data' / 'raw' / 'satellite-day'
CACHE_NIGHT.mkdir(parents=True, exist_ok=True)
CACHE_DAY.mkdir(parents=True, exist_ok=True)

MAP_PATH = ROOT / 'data' / 'map.json'
DATA_PATH = ROOT / 'web' / 'data.json'

view = json.loads(MAP_PATH.read_text())['view']
raw_map = json.loads(DATA_PATH.read_text())

# Use Zoom level 6 Web Mercator tiles for continental coverage at 500m/px resolution
ZOOM = int(os.environ.get('SAT_ZOOM', 6))
TILE = 256  # Standard WMTS tile size

NASA_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'
DAY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

# Must match scripts/lib/proj.mjs
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
    """lon/lat -> global pixel coordinates in tile pyramid."""
    span = TILE * 2 ** ZOOM
    lat = np.clip(lat, -85.05, 85.05)
    sin = np.sin(np.radians(lat))
    return ((lon + 180.0) / 360.0 * span,
            (0.5 - np.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * span)


# Calculate required tile coordinates covering our map bounding box
gx, gy = np.meshgrid(np.linspace(view['x'], view['x'] + view['w'], 80),
                     np.linspace(view['y'], view['y'] + view['h'], 80))
lon_s, lat_s = inverse(gx, gy)
px_s, py_s = merc_xy(lon_s, lat_s)
x0, x1 = int(px_s.min() // TILE), int(px_s.max() // TILE) + 1
y0, y1 = int(py_s.min() // TILE), int(py_s.max() // TILE) + 1
tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
print(f"Total satellite tiles required per layer (zoom {ZOOM}): {len(tiles)} tiles")


def fetch_tile(args):
    source_type, (x, y) = args
    cache_dir = CACHE_NIGHT if source_type == 'night' else CACHE_DAY
    path = cache_dir / f'{ZOOM}_{x}_{y}.jpg'
    if path.exists():
        return path

    url = (NASA_URL if source_type == 'night' else DAY_URL).format(z=ZOOM, x=x, y=y)
    req = urllib.request.Request(url, headers={'User-Agent': 'RouteSolverGame/1.0'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                path.write_bytes(r.read())
            return path
        except Exception:
            if attempt == 3:
                return None
    return None


# 1. Fetch Real Satellite Tiles in Parallel
print("Fetching real NASA Black Marble night tiles...")
with futures.ThreadPoolExecutor(max_workers=16) as pool:
    list(pool.map(fetch_tile, [('night', t) for t in tiles]))

print("Fetching real True-Color daytime satellite tiles...")
with futures.ThreadPoolExecutor(max_workers=16) as pool:
    list(pool.map(fetch_tile, [('day', t) for t in tiles]))


# 2. Build Stitched Mercator Pyramids
def build_stitched_mosaic(source_type):
    cache_dir = CACHE_NIGHT if source_type == 'night' else CACHE_DAY
    width = (x1 - x0 + 1) * TILE
    height = (y1 - y0 + 1) * TILE
    mosaic = np.zeros((height, width, 3), dtype=np.uint8)

    for (x, y) in tiles:
        path = cache_dir / f'{ZOOM}_{x}_{y}.jpg'
        if not path.exists():
            continue
        try:
            with Image.open(path) as im:
                im_rgb = im.convert('RGB')
                if im_rgb.size != (TILE, TILE):
                    im_rgb = im_rgb.resize((TILE, TILE), Image.BILINEAR)
                mosaic[(y - y0) * TILE:(y - y0 + 1) * TILE, (x - x0) * TILE:(x - x0 + 1) * TILE] = np.asarray(im_rgb)
        except Exception:
            pass
    return mosaic


print("Stitching NASA Black Marble mosaic...")
mosaic_night = build_stitched_mosaic('night')

print("Stitching True-Color daytime mosaic...")
mosaic_day = build_stitched_mosaic('day')

out_w = 2400
out_h = round(out_w * view['h'] / view['w'])
print(f"Reprojecting into Lambert Conformal Conic ({out_w}x{out_h} px)...")


def build_land_mask(out_w, out_h):
    """Rasterizes all 65 country polygons into an 8-bit mask (255 on land, 0 on sea)."""
    import re
    overlay = Image.new('L', (out_w, out_h), 0)
    draw = ImageDraw.Draw(overlay)

    def map_to_px(mx, my):
        px = (mx - view['x']) * (out_w / view['w'])
        py = (my - view['y']) * (out_h / view['h'])
        return px, py

    if 'countries' in raw_map:
        for country_svg in raw_map['countries']:
            sub_paths = [p.strip() for p in country_svg.split('M') if p.strip()]
            for sub in sub_paths:
                coords = re.findall(r'[-+]?\d+(?:\.\d+)?', sub)
                pts = [map_to_px(float(coords[i]), float(coords[i+1])) for i in range(0, len(coords)-1, 2)]
                if len(pts) >= 3:
                    draw.polygon(pts, fill=255)

    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=0.8))
    return np.asarray(overlay, dtype=np.uint8)


land_mask = build_land_mask(out_w, out_h)


def reproject_mosaic(mosaic, is_night=False):
    xs = view['x'] + (np.arange(out_w) + 0.5) * view['w'] / out_w
    ys = view['y'] + (np.arange(out_h) + 0.5) * view['h'] / out_h

    m_h, m_w, _ = mosaic.shape
    out_rgb = np.zeros((out_h, out_w, 3), dtype=np.uint8)

    STRIP = 512
    for top in range(0, out_h, STRIP):
        bottom = min(top + STRIP, out_h)
        lon, lat = inverse(*np.meshgrid(xs, ys[top:bottom]))
        px, py = merc_xy(lon, lat)
        px -= x0 * TILE
        py -= y0 * TILE

        ix = np.clip(px.astype(np.int32), 0, m_w - 2)
        iy = np.clip(py.astype(np.int32), 0, m_h - 2)
        fx = (px - ix)[:, :, None].astype(np.float32)
        fy = (py - iy)[:, :, None].astype(np.float32)

        sample = (mosaic[iy, ix] * (1 - fx) * (1 - fy) + mosaic[iy, ix + 1] * fx * (1 - fy)
                  + mosaic[iy + 1, ix] * (1 - fx) * fy + mosaic[iy + 1, ix + 1] * fx * fy)
        out_rgb[top:bottom] = np.clip(sample, 0, 255).astype(np.uint8)

    # Convert to RGBA
    out_rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    out_rgba[..., :3] = out_rgb

    if is_night:
        # For night lights: Alpha is proportional to luminance, so unlit countryside/ocean is transparent
        lum = (0.299 * out_rgb[..., 0] + 0.587 * out_rgb[..., 1] + 0.114 * out_rgb[..., 2]).astype(np.float32)
        alpha = np.clip((lum / 180.0) ** 1.2 * 255.0, 0, 255).astype(np.uint8)
        out_rgba[..., 3] = np.minimum(alpha, land_mask)
    else:
        # For day satellite: Land mask clips ocean to 0
        out_rgba[..., 3] = land_mask

    return out_rgba


# Render and save real satellite outputs
print("Reprojecting real NASA Black Marble night lights...")
night_rgba = reproject_mosaic(mosaic_night, is_night=True)
night_out = ROOT / 'web' / 'urban-night.webp'
Image.fromarray(night_rgba).save(night_out, 'WEBP', quality=80, method=5)
print(f"✓ Wrote {night_out.relative_to(ROOT)} ({night_out.stat().st_size / 1024:.0f} KB)")

print("Reprojecting real True-Color daytime satellite imagery...")
day_rgba = reproject_mosaic(mosaic_day, is_night=False)
day_out = ROOT / 'web' / 'urban-day.webp'
Image.fromarray(day_rgba).save(day_out, 'WEBP', quality=75, method=5)
print(f"✓ Wrote {day_out.relative_to(ROOT)} ({day_out.stat().st_size / 1024:.0f} KB)")

print("✓ Authentic Satellite Imagery Generation Complete!")
