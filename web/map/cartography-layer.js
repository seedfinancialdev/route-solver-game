/**
 * Vector Cartography Canvas Renderer
 * High-performance, clean cartographic rendering for lakes, rivers, urban footprints,
 * background towns, and road networks.
 */

export class CartographyLayer {
  constructor() {
    this.pathCache = new Map(); // svgStr -> Path2D instance

    // Layer Visibility Toggles
    this.showWater = true;
    this.showFarmland = true; // Urban footprints
    this.showForest = true;   // Raster forest layer toggle
    this.showTowns = true;    // Background towns
    this.showRoads = true;
    this.showStreets = true;

    // Opacity Sliders & Blending
    this.waterOpacity = 1.0;
    this.farmlandOpacity = 0.45;
    this.forestOpacity = 0.65;
    this.townsOpacity = 0.50;
    this.forestBlendMode = 'multiply';
  }

  getPath2D(svgStr) {
    if (!svgStr || typeof svgStr !== 'string') return null;
    if (!this.pathCache.has(svgStr)) {
      try {
        this.pathCache.set(svgStr, new Path2D(svgStr));
      } catch {
        this.pathCache.set(svgStr, null);
      }
    }
    return this.pathCache.get(svgStr);
  }

  render(ctx, camera, theme, g) {
    if (!g) return;

    const dpr = window.devicePixelRatio || 1;
    const scaleX = camera.viewportWidth / camera.current.w;
    const scaleY = camera.viewportHeight / camera.current.h;
    const translateX = -camera.current.x * scaleX;
    const translateY = -camera.current.y * scaleY;

    // 1. Water Bodies (Lakes & Rivers)
    if (this.showWater) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.globalAlpha = this.waterOpacity;

      // Lakes (polygons)
      if (g.lakes && g.lakes.length) {
        ctx.fillStyle = theme.water || '#12283a';
        for (const lakePath of g.lakes) {
          const path = this.getPath2D(lakePath);
          if (path) ctx.fill(path);
        }
      }

      // Rivers (strokes)
      if (g.rivers && g.rivers.length) {
        ctx.strokeStyle = theme.water || '#12283a';
        ctx.lineWidth = 1.5 / scaleX;
        for (const riverPath of g.rivers) {
          const path = this.getPath2D(riverPath);
          if (path) ctx.stroke(path);
        }
      }
      ctx.restore();
    }

    // 2. Urban Footprints (Built-up City Footprints)
    if (this.showFarmland && g.urbanAreas && g.urbanAreas.length) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.fillStyle = theme.farmland || 'rgba(162, 137, 92, 0.45)';
      ctx.globalAlpha = this.farmlandOpacity;

      for (const areaPath of g.urbanAreas) {
        const path = this.getPath2D(areaPath);
        if (path) ctx.fill(path);
      }
      ctx.restore();
    }

    // 3. Background Towns (Independent layer)
    if (this.showTowns && g.towns && g.towns.length && camera.current.w <= 1000) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.fillStyle = 'rgba(200, 180, 140, 0.5)';
      ctx.globalAlpha = this.townsOpacity;

      for (const town of g.towns) {
        const r = (town.tier === 1 ? 2.2 : 1.4) / scaleX;
        ctx.beginPath();
        ctx.arc(town.x, town.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Road Networks (Graph Edges with zoom-based LOD width scaling)
    if (this.showRoads && g.adj) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Group road segments by pace tier
      const motorways = [];
      const trunks = [];
      const primaries = [];

      for (const cityEdges of g.adj) {
        for (const edge of cityEdges) {
          if (!edge.shape || edge.shape.length < 2) continue;
          const pace = edge.pace[0] ?? 1;
          if (pace === 0) motorways.push(edge.shape);
          else if (pace === 1) trunks.push(edge.shape);
          else primaries.push(edge.shape);
        }
      }

      const isOverview = camera.current.w > 1200;

      // Draw Motorways
      ctx.strokeStyle = isOverview ? 'rgba(217, 75, 54, 0.35)' : (theme.roadMotorway || '#d94b36');
      ctx.lineWidth = (isOverview ? 0.6 : (theme.roadWidthMotorway || 2.2)) / scaleX;
      this.drawShapeBatch(ctx, motorways);

      // Draw Trunks
      if (camera.current.w <= 1400) {
        ctx.strokeStyle = theme.roadTrunk || '#e6a13c';
        ctx.lineWidth = (theme.roadWidthTrunk || 1.6) / scaleX;
        this.drawShapeBatch(ctx, trunks);
      }

      // Draw Primaries
      if (camera.current.w <= 800) {
        ctx.strokeStyle = theme.roadPrimary || '#5f6f82';
        ctx.lineWidth = (theme.roadWidthPrimary || 1.0) / scaleX;
        this.drawShapeBatch(ctx, primaries);
      }

      ctx.restore();
    }
  }

  drawShapeBatch(ctx, shapeList) {
    if (!shapeList.length) return;
    ctx.beginPath();
    for (const shape of shapeList) {
      for (let i = 0; i < shape.length; i++) {
        if (i === 0) ctx.moveTo(shape[i][0], shape[i][1]);
        else ctx.lineTo(shape[i][0], shape[i][1]);
      }
    }
    ctx.stroke();
  }
}
