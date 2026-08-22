/**
 * Real Cartographic Web Map Tile Layer Renderer
 * Renders real OpenTopoMap, Esri Topo, or Satellite forest & cartography tiles
 * aligned with the Lambert projected map engine coordinates.
 */

import { unproject, project, lonLatToTile, tileToLonLatBounds } from './proj.js';

export const TILE_PROVIDERS = {
  openTopo: {
    name: 'OpenTopoMap (Real Forests & Topo)',
    url: (x, y, z) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenTopoMap, © OpenStreetMap',
    minZoom: 4,
    maxZoom: 15,
  },
  esriTopo: {
    name: 'Esri World Topo Map',
    url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri, HERE, Garmin, USGS',
    minZoom: 3,
    maxZoom: 16,
  },
  esriImagery: {
    name: 'Esri World Satellite Imagery',
    url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: '© Esri, Maxar, Earthstar Geographics',
    minZoom: 3,
    maxZoom: 16,
  },
  cartoVoyager: {
    name: 'CartoDB Voyager',
    url: (x, y, z) => `https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${z}/${x}/${y}.png`,
    attribution: '© CartoDB, © OpenStreetMap',
    minZoom: 3,
    maxZoom: 16,
  }
};

export class RealTileLayer {
  constructor() {
    this.providerKey = 'openTopo';
    this.showTiles = true;
    this.opacity = 0.65;
    this.blendMode = 'multiply';

    this.tileCache = new Map(); // tileKey -> { img, loaded }
  }

  setProvider(providerKey) {
    if (TILE_PROVIDERS[providerKey]) {
      this.providerKey = providerKey;
      this.tileCache.clear();
    }
  }

  calculateZoomLevel(cameraSpanKm) {
    if (cameraSpanKm > 2500) return 5;
    if (cameraSpanKm > 1200) return 6;
    if (cameraSpanKm > 600) return 7;
    if (cameraSpanKm > 300) return 8;
    if (cameraSpanKm > 150) return 9;
    if (cameraSpanKm > 75) return 10;
    if (cameraSpanKm > 35) return 11;
    if (cameraSpanKm > 15) return 12;
    if (cameraSpanKm > 7) return 13;
    return 14;
  }

  render(ctx, camera) {
    if (!this.showTiles) return;

    const provider = TILE_PROVIDERS[this.providerKey] || TILE_PROVIDERS.openTopo;
    const z = Math.min(Math.max(this.calculateZoomLevel(camera.current.w), provider.minZoom), provider.maxZoom);

    // Convert viewport corners to lat/lon
    const nwWorld = { x: camera.current.x, y: camera.current.y };
    const seWorld = { x: camera.current.x + camera.current.w, y: camera.current.y + camera.current.h };

    const nwLatLon = unproject(nwWorld.x, nwWorld.y);
    const seLatLon = unproject(seWorld.x, seWorld.y);

    // Calculate tile bounding box
    const tileNW = lonLatToTile(Math.min(nwLatLon.lon, seLatLon.lon), Math.max(nwLatLon.lat, seLatLon.lat), z);
    const tileSE = lonLatToTile(Math.max(nwLatLon.lon, seLatLon.lon), Math.min(nwLatLon.lat, seLatLon.lat), z);

    const minTileX = Math.min(tileNW.x, tileSE.x);
    const maxTileX = Math.max(tileNW.x, tileSE.x);
    const minTileY = Math.min(tileNW.y, tileSE.y);
    const maxTileY = Math.max(tileNW.y, tileSE.y);

    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.globalCompositeOperation = this.blendMode;

    // Fetch and render overlapping tiles
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        const key = `${this.providerKey}_${z}_${tx}_${ty}`;

        if (!this.tileCache.has(key)) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = provider.url(tx, ty, z);
          const entry = { img, loaded: false };
          img.onload = () => { entry.loaded = true; };
          this.tileCache.set(key, entry);
        }

        const tileEntry = this.tileCache.get(key);
        if (!tileEntry || !tileEntry.loaded) continue;

        // Project tile bounds back to map coordinates
        const bounds = tileToLonLatBounds(tx, ty, z);
        const nwProj = project(bounds.minLon, bounds.maxLat);
        const seProj = project(bounds.maxLon, bounds.minLat);

        const p1 = camera.worldToScreen(nwProj.x, nwProj.y);
        const p2 = camera.worldToScreen(seProj.x, seProj.y);

        const w = p2.x - p1.x;
        const h = p2.y - p1.y;

        ctx.drawImage(tileEntry.img, p1.x, p1.y, w, h);
      }
    }

    ctx.restore();
  }
}
