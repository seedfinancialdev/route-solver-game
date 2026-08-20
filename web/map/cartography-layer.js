/**
 * Vector Cartography Canvas Renderer
 * High-performance rendering for lakes, rivers, urban footprints, background towns,
 * and road networks matching Lambert Conformal Conic map projection.
 */

export class CartographyLayer {
  constructor() {
    this.pathCache = new Map(); // svgStr -> Path2D instance

    // Layer Visibility Toggles
    this.showWater = true;
    this.showFarmland = true; // Urban footprints
    this.showRoads = true;
    this.showStreets = true;

    // Opacity Sliders
    this.waterOpacity = 1.0;
    this.farmlandOpacity = 0.45;
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
        ctx.fillStyle = theme.water || '#12283a';
        for (const lakePath of g.lakes) {
          ctx.fill(this.getPath2D(lakePath));
        }
      }

      // Rivers (strokes)
      if (g.rivers && g.rivers.length) {
        ctx.strokeStyle = theme.water || '#12283a';
        ctx.lineWidth = 1.5 / scaleX;
        for (const riverPath of g.rivers) {
          ctx.stroke(this.getPath2D(riverPath));
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
        ctx.fill(this.getPath2D(areaPath));
      }
      ctx.restore();
    }

    // 3. Background Towns
    if (g.towns && g.towns.length && camera.current.w <= 1000) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.fillStyle = 'rgba(200, 180, 140, 0.5)';

      for (const town of g.towns) {
        const r = (town.tier === 1 ? 2.2 : 1.4) / scaleX;
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
