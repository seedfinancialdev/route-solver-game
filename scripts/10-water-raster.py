"""Pre-Rendered Lambert Raster Water Mask Generator.

Generates pixel-perfect raster water maps (`web/water.webp` and `web/water-detail.webp`)
using the exact inverse Lambert Conformal Conic coordinate grid and 236 multi-segment river corridors and lakes.

  python3 scripts/10-water-raster.py
"""
import concurrent.futures as futures
import json, math, pathlib, re
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = pathlib.Path(__file__).resolve().parent.parent

OUTPUTS = [('water.webp', 2400, 80), ('water-detail.webp', 6000, 68)]

view = json.loads((ROOT / 'data' / 'map.json').read_text())['view']
raw_map = json.loads((ROOT / 'web' / 'data.json').read_text())


def render_water(box, out_w, out_h):
    """Renders a clean raster water image from lake polygons and river paths."""
    # 1. Create 8-bit alpha mask canvas
    overlay = Image.new('L', (out_w, out_h), 0)
    draw = ImageDraw.Draw(overlay)

    # Convert map (x, y) km to raster pixel coordinates
    def map_to_px(mx, my):
        px = (mx - box['x']) * (out_w / box['w'])
        py = (my - box['y']) * (out_h / box['h'])
        return px, py

    # 2. Draw Lake Polygons
    if 'lakes' in raw_map:
        for lake_svg in raw_map['lakes']:
            sub_paths = [p.strip() for p in lake_svg.split('M') if p.strip()]
            for sub in sub_paths:
                coords = re.findall(r'[-+]?\d+(?:\.\d+)?', sub)
                pts = [map_to_px(float(coords[i]), float(coords[i+1])) for i in range(0, len(coords)-1, 2)]
                if len(pts) >= 3:
                    draw.polygon(pts, fill=255)

    # 3. Draw River Channels (All 236 sub-segments)
    if 'rivers' in raw_map:
        stroke_w = max(int(round(6.0 * (out_w / 2400.0))), 3)
        for river_svg in raw_map['rivers']:
            sub_paths = [p.strip() for p in river_svg.split('M') if p.strip()]
            for sub in sub_paths:
                coords = re.findall(r'[-+]?\d+(?:\.\d+)?', sub)
                pts = [map_to_px(float(coords[i]), float(coords[i+1])) for i in range(0, len(coords)-1, 2)]
                if len(pts) >= 2:
                    draw.line(pts, fill=255, width=stroke_w)

    water_mask = np.asarray(overlay, dtype=np.float32) / 255.0

    # 4. Generate RGBA Water Image
    # Deep River & Lake Blue: RGB(14, 38, 58)
    rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    rgba[..., 0] = 14  # Red
    rgba[..., 1] = 38  # Green
    rgba[..., 2] = 58  # Blue
    rgba[..., 3] = (water_mask * 255.0).astype(np.uint8)

    return rgba


print("Generating clean Lambert raster water maps...")
for name, out_w, quality in OUTPUTS:
    out_h = round(out_w * view['h'] / view['w'])
    img_rgba = render_water(view, out_w, out_h)
    out = ROOT / 'web' / name
    Image.fromarray(img_rgba).save(out, 'WEBP', quality=quality, method=5)
    print(f'wrote {out.relative_to(ROOT)}  {out_w}x{out_h}  '
          f'{out.stat().st_size / 1024:.0f} KB')

print("✓ Clean Lambert raster water maps generated successfully!")
