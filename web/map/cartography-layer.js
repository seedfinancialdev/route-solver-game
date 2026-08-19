/**
 * Multi-Layered Cartography & Land-Use Canvas Renderer
 * High-performance single-pass batch rendering for land use (forests, farmland, water)
 * and road networks (motorways, trunks, primary roads, street grids).
 */

export class CartographyLayer {
  constructor() {
    this.landuseData = null;
    this.roadNetworkData = null;
    this.streetDetailCache = new Map(); // cityId -> street features

    // Controls & Toggles
    this.showForest = true;
    this.showFarmland = true;
    this.showWater = true;
    this.showRoads = true;
    this.showStreets = true;

    this.forestOpacity = 0.75;
    this.farmlandOpacity = 0.52;

    this.init();
  }

  async init() {
    // Optionally pre-fetch cartography assets if available
    try {
      const res = await fetch('../data.json');
      const data = await res.json();
      if (data.cartography) {
        this.landuseData = data.cartography.landuse || null;
        this.roadNetworkData = data.cartography.roads || null;
      }
    } catch {
      // Graceful fallback
    }
  }

  render(ctx, camera, theme, graphData) {
    ctx.save();

    // 1. Render Water Bodies & Coastlines / Rivers
    if (this.showWater && graphData && graphData.water) {
      this.renderWater(ctx, camera, theme, graphData.water);
    }

    // 2. Render Land Cover (Forests & Farmland)
    if (this.landuseData) {
      if (this.showFarmland && camera.current.w <= 850) {
        this.renderPolygons(ctx, camera, this.landuseData.farmland, theme.farmland, this.farmlandOpacity);
      }
      if (this.showForest && camera.current.w <= 850) {
        this.renderPolygons(ctx, camera, this.landuseData.forest, theme.forest, this.forestOpacity);
      }
    }

    // 3. Render Road Networks (Motorway, Trunk, Primary)
    if (this.showRoads && graphData) {
      this.renderGraphRoads(ctx, camera, theme, graphData);
    }

    // 4. Render City Street Grids at Close Zoom (≤ 14 km)
    if (this.showStreets && camera.current.w <= 14 && graphData) {
      this.renderStreetGrids(ctx, camera, theme, graphData);
    }

    ctx.restore();
  }

  renderWater(ctx, camera, theme, waterFeatures) {
    ctx.fillStyle = theme.water;
    ctx.strokeStyle = theme.water;
    ctx.lineWidth = 1.5;

    for (const feat of waterFeatures) {
      if (!feat.coords || !feat.coords.length) continue;
      ctx.beginPath();
      for (let i = 0; i < feat.coords.length; i++) {
        const p = camera.worldToScreen(feat.coords[i][0], feat.coords[i][1]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      if (feat.isPolygon) ctx.fill();
      else ctx.stroke();
    }
  }

  renderPolygons(ctx, camera, polygonList, colorStyle, opacity) {
    if (!polygonList || !polygonList.length) return;

    ctx.fillStyle = colorStyle;
    ctx.globalAlpha = opacity;
    ctx.beginPath();

    for (const poly of polygonList) {
      if (!poly.points || poly.points.length < 3) continue;
      for (let i = 0; i < poly.points.length; i++) {
        const p = camera.worldToScreen(poly.points[i][0], poly.points[i][1]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  renderGraphRoads(ctx, camera, theme, g) {
    if (!g.edges) return;

    // Single-pass batch path grouping by pace/road classification
    const motorways = [];
    const trunks = [];
    const primaries = [];

    for (const e of g.edges) {
      if (!e.path || e.path.length < 2) continue;

      // Filter by classification or pace
      if (e.pace >= 85) motorways.push(e);
      else if (e.pace >= 65) trunks.push(e);
      else primaries.push(e);
    }

    // Draw Motorways
    this.drawPathBatch(ctx, camera, motorways, theme.roadMotorway, theme.roadWidthMotorway);

    // Draw Trunks (visible at ≤ 1200 km)
    if (camera.current.w <= 1200) {
      this.drawPathBatch(ctx, camera, trunks, theme.roadTrunk, theme.roadWidthTrunk);
    }

    // Draw Primaries (visible at ≤ 600 km)
    if (camera.current.w <= 600) {
      this.drawPathBatch(ctx, camera, primaries, theme.roadPrimary, theme.roadWidthPrimary);
    }
  }

  drawPathBatch(ctx, camera, edgeList, color, width) {
    if (!edgeList.length) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(width * (1200 / camera.current.w), 1.0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    for (const e of edgeList) {
      const path = e.path;
      for (let i = 0; i < path.length; i++) {
        const p = camera.worldToScreen(path[i][0], path[i][1]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }

  renderStreetGrids(ctx, camera, theme, g) {
    // Street grid rendering at close zoom
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.0;

    // Iterate cities in viewport
    for (const city of Object.values(g.cities)) {
      const p = camera.worldToScreen(city.x, city.y);
      if (p.x < -100 || p.x > camera.viewportWidth + 100 || p.y < -100 || p.y > camera.viewportHeight + 100) continue;

      // Draw local street grid radius indicator
      ctx.beginPath();
      ctx.arc(p.x, p.y, (0.9 / camera.current.w) * camera.viewportWidth, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
