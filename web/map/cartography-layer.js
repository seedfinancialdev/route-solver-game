/**
 * Multi-Layered Cartography Canvas Renderer
 * Renders lakes, rivers, urban footprints, background towns, and real road geometries
 * using HTML5 Canvas Path2D and view matrix projections for 60fps rendering.
 */

export class CartographyLayer {
  constructor() {
    this.pathCache = new Map(); // svgStr -> Path2D instance

    // Layer Visibility Toggles
    this.showWater = true;
    this.showFarmland = true; // Urban footprints / land cover
    this.showForest = true;    // Background towns & physical geography
    this.showRoads = true;
    this.showStreets = true;

    // Opacity Sliders
    this.waterOpacity = 1.0;
    this.farmlandOpacity = 0.52;
    this.forestOpacity = 0.75;
  }

  getPath2D(svgStr) {
    if (!this.pathCache.has(svgStr)) {
      this.pathCache.set(svgStr, new Path2D(svgStr));
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
        ctx.fillStyle = theme.water;
        for (const lakePath of g.lakes) {
          const path = this.getPath2D(lakePath);
          ctx.fill(path);
        }
      }

      // Rivers (strokes)
      if (g.rivers && g.rivers.length) {
        ctx.strokeStyle = theme.water;
        ctx.lineWidth = 1.5 / scaleX;
        for (const riverPath of g.rivers) {
          const path = this.getPath2D(riverPath);
          ctx.stroke(path);
        }
      }
      ctx.restore();
    }

    // 2. Urban Footprints / Land Cover (urbanAreas)
    if (this.showFarmland && g.urbanAreas && g.urbanAreas.length) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.fillStyle = theme.farmland;
      ctx.globalAlpha = this.farmlandOpacity;

      for (const areaPath of g.urbanAreas) {
        const path = this.getPath2D(areaPath);
        ctx.fill(path);
      }
      ctx.restore();
    }

    // 3. Background Towns & Geography
    if (this.showForest && g.towns && g.towns.length && camera.current.w <= 1200) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.fillStyle = theme.forest;
      ctx.globalAlpha = this.forestOpacity;

      for (const town of g.towns) {
        const r = (town.tier === 1 ? 2.5 : 1.5) / scaleX;
        ctx.beginPath();
        ctx.arc(town.x, town.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Road Networks (Graph Edges with decoded shape & pace)
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

      // Draw Motorways
      ctx.strokeStyle = theme.roadMotorway;
      ctx.lineWidth = Math.max(theme.roadWidthMotorway, 1.2) / scaleX;
      this.drawShapeBatch(ctx, motorways);

      // Draw Trunks
      if (camera.current.w <= 1400) {
        ctx.strokeStyle = theme.roadTrunk;
        ctx.lineWidth = Math.max(theme.roadWidthTrunk, 1.0) / scaleX;
        this.drawShapeBatch(ctx, trunks);
      }

      // Draw Primaries
      if (camera.current.w <= 800) {
        ctx.strokeStyle = theme.roadPrimary;
        ctx.lineWidth = Math.max(theme.roadWidthPrimary, 0.8) / scaleX;
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
