/**
 * Multi-Tier Elevation Relief, Raster Forest, & Raster Water Layer Renderer
 * Renders Overview, Detail pass, Fine Tile grid (6x6), pre-rendered Lambert raster forest layer,
 * and terrain-carved raster water maps with 1:1 pixel alignment and cache-busting asset loading.
 */

export class TerrainLayer {
  constructor(mapBounds) {
    this.mapBounds = mapBounds; // { x, y, w, h }
    this.showTerrain = true;
    this.showForestRaster = true;
    this.showWaterRaster = true;

    this.overviewImg = null;
    this.detailImg = null;
    this.forestImg = null;
    this.forestDetailImg = null;
    this.waterImg = null;
    this.waterDetailImg = null;

    this.tilesManifest = [];
    this.loadedTiles = new Map(); // tile.file -> HTMLImageElement

    this.overviewLoaded = false;
    this.detailLoaded = false;
    this.forestLoaded = false;
    this.forestDetailLoaded = false;
    this.waterLoaded = false;
    this.waterDetailLoaded = false;

    this.init();
  }

  async init() {
    const v = Date.now();

    // Load Terrain Overview image
    this.overviewImg = new Image();
    this.overviewImg.onload = () => { this.overviewLoaded = true; };
    this.overviewImg.src = `../terrain.webp?v=${v}`;
    if (this.overviewImg.complete && this.overviewImg.naturalWidth !== 0) {
      this.overviewLoaded = true;
    }

    // Load Terrain Detail image
    this.detailImg = new Image();
    this.detailImg.onload = () => { this.detailLoaded = true; };
    this.detailImg.src = `../terrain-detail.webp?v=${v}`;
    if (this.detailImg.complete && this.detailImg.naturalWidth !== 0) {
      this.detailLoaded = true;
    }

    // Load Forest Overview raster image
    this.forestImg = new Image();
    this.forestImg.onload = () => { this.forestLoaded = true; };
    this.forestImg.src = `../forest.webp?v=${v}`;
    if (this.forestImg.complete && this.forestImg.naturalWidth !== 0) {
      this.forestLoaded = true;
    }

    // Load Forest Detail raster image
    this.forestDetailImg = new Image();
    this.forestDetailImg.onload = () => { this.forestDetailLoaded = true; };
    this.forestDetailImg.src = `../forest-detail.webp?v=${v}`;
    if (this.forestDetailImg.complete && this.forestDetailImg.naturalWidth !== 0) {
      this.forestDetailLoaded = true;
    }

    // Load Water Overview raster image
    this.waterImg = new Image();
    this.waterImg.onload = () => { this.waterLoaded = true; };
    this.waterImg.src = `../water.webp?v=${v}`;
    if (this.waterImg.complete && this.waterImg.naturalWidth !== 0) {
      this.waterLoaded = true;
    }

    // Load Water Detail raster image
    this.waterDetailImg = new Image();
    this.waterDetailImg.onload = () => { this.waterDetailLoaded = true; };
    this.waterDetailImg.src = `../water-detail.webp?v=${v}`;
    if (this.waterDetailImg.complete && this.waterDetailImg.naturalWidth !== 0) {
      this.waterDetailLoaded = true;
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

  render(ctx, camera, theme, forestOpacity = 0.65, forestBlendMode = 'multiply', waterOpacity = 1.0) {
    if (!this.showTerrain) return;

    // Fallback: If overviewLoaded is not set yet, check img.complete
    if (!this.overviewLoaded && this.overviewImg && this.overviewImg.complete && this.overviewImg.naturalWidth !== 0) {
      this.overviewLoaded = true;
    }

    if (!this.overviewLoaded) return;

    this.ensureTiles(camera);

    const b = this.mapBounds;
    const p1 = camera.worldToScreen(b.x, b.y);
    const p2 = camera.worldToScreen(b.x + b.w, b.y + b.h);
    const screenW = p2.x - p1.x;
    const screenH = p2.y - p1.y;

    // 1. Draw Elevation Hillshade Base
    ctx.save();
    ctx.globalAlpha = theme.terrainOpacity;
    ctx.globalCompositeOperation = theme.terrainBlend || 'multiply';

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

    // 2. Draw Pre-Rendered Lambert Raster Water Layer (Ocean, Lakes, & River Valleys)
    if (this.showWaterRaster && (this.waterLoaded || (this.waterImg && this.waterImg.complete && this.waterImg.naturalWidth !== 0))) {
      ctx.save();
      ctx.globalAlpha = waterOpacity;
      ctx.globalCompositeOperation = 'multiply';

      const isWaterDetailAvailable = (this.waterDetailLoaded || (this.waterDetailImg && this.waterDetailImg.complete && this.waterDetailImg.naturalWidth !== 0));
      const wImg = (isWaterDetailAvailable && camera.current.w <= 1400) ? this.waterDetailImg : this.waterImg;

      ctx.drawImage(wImg, p1.x, p1.y, screenW, screenH);
      ctx.restore();
    }

    // 3. Draw Pre-Rendered Lambert Raster Forest Layer
    if (this.showForestRaster && (this.forestLoaded || (this.forestImg && this.forestImg.complete && this.forestImg.naturalWidth !== 0))) {
      ctx.save();
      ctx.globalAlpha = forestOpacity;
      ctx.globalCompositeOperation = forestBlendMode || 'multiply';

      const isForestDetailAvailable = (this.forestDetailLoaded || (this.forestDetailImg && this.forestDetailImg.complete && this.forestDetailImg.naturalWidth !== 0));
      const fImg = (isForestDetailAvailable && camera.current.w <= 1400) ? this.forestDetailImg : this.forestImg;

      ctx.drawImage(fImg, p1.x, p1.y, screenW, screenH);
      ctx.restore();
    }
  }
}
