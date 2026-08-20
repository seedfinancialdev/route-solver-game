/**
 * Multi-Tier Elevation Relief Terrain Renderer
 * Renders Overview, Detail pass, and Fine Tile grid (6x6) with smooth cross-fade opacity.
 */

export class TerrainLayer {
  constructor(mapBounds) {
    this.mapBounds = mapBounds; // { x, y, w, h }
    this.showTerrain = true;
    this.overviewImg = null;
    this.detailImg = null;
    this.tilesManifest = [];
    this.loadedTiles = new Map(); // tile.file -> HTMLImageElement

    this.overviewLoaded = false;
    this.detailLoaded = false;

    this.init();
  }

  async init() {
    // Load Overview image
    this.overviewImg = new Image();
    this.overviewImg.onload = () => { this.overviewLoaded = true; };
    this.overviewImg.src = '../terrain.webp';
    if (this.overviewImg.complete && this.overviewImg.naturalWidth !== 0) {
      this.overviewLoaded = true;
    }

    // Load Detail image
    this.detailImg = new Image();
    this.detailImg.onload = () => { this.detailLoaded = true; };
    this.detailImg.src = '../terrain-detail.webp';
    if (this.detailImg.complete && this.detailImg.naturalWidth !== 0) {
      this.detailLoaded = true;
    }

    // Load fine tiles manifest
    try {
      const res = await fetch('../terrain-tiles.json');
      const json = await res.json();
      this.tilesManifest = json.tiles || [];
    } catch {
      this.tilesManifest = [];
    }
  }

  ensureTiles(camera) {
    const TILE_ZOOM_KM = 850; // Below this zoom level, fetch & show fine tiles
    if (camera.current.w > TILE_ZOOM_KM || !this.tilesManifest.length) return;

    for (const t of this.tilesManifest) {
      if (this.loadedTiles.has(t.file)) continue;

      // Check viewport overlap
      const overlaps = t.x < camera.current.x + camera.current.w &&
                       t.x + t.w > camera.current.x &&
                       t.y < camera.current.y + camera.current.h &&
                       t.y + t.h > camera.current.y;

      if (overlaps) {
        const img = new Image();
        img.src = `../${t.file}`;
        this.loadedTiles.set(t.file, { img, loaded: false, box: t });
        img.onload = () => {
          const entry = this.loadedTiles.get(t.file);
          if (entry) entry.loaded = true;
        };
        if (img.complete && img.naturalWidth !== 0) {
          const entry = this.loadedTiles.get(t.file);
          if (entry) entry.loaded = true;
        }
      }
    }
  }

  render(ctx, camera, theme) {
    if (!this.showTerrain) return;

    // Fallback: If overviewLoaded is not set yet, check img.complete
    if (!this.overviewLoaded && this.overviewImg && this.overviewImg.complete && this.overviewImg.naturalWidth !== 0) {
      this.overviewLoaded = true;
    }

    if (!this.overviewLoaded) return;

    this.ensureTiles(camera);

    ctx.save();
    ctx.globalAlpha = theme.terrainOpacity;
    ctx.globalCompositeOperation = theme.terrainBlend || 'multiply';

    const b = this.mapBounds;
    const p1 = camera.worldToScreen(b.x, b.y);
    const p2 = camera.worldToScreen(b.x + b.w, b.y + b.h);
    const screenW = p2.x - p1.x;
    const screenH = p2.y - p1.y;

    // Draw Overview / Detail base
    const isDetailAvailable = (this.detailLoaded || (this.detailImg && this.detailImg.complete && this.detailImg.naturalWidth !== 0));
    const baseImg = (isDetailAvailable && camera.current.w <= 1400) ? this.detailImg : this.overviewImg;
    ctx.drawImage(baseImg, p1.x, p1.y, screenW, screenH);

    // Draw Fine Tiles overlay if in close zoom
    if (camera.current.w <= 850) {
      for (const [, entry] of this.loadedTiles) {
        if (!entry.loaded) continue;
        const tb = entry.box;
        const tp1 = camera.worldToScreen(tb.x, tb.y);
        const tp2 = camera.worldToScreen(tb.x + tb.w, tb.y + tb.h);
        ctx.drawImage(entry.img, tp1.x, tp1.y, tp2.x - tp1.x, tp2.y - tp1.y);
      }
    }

    ctx.restore();
  }
}
