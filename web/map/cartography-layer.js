/**
 * Vector Cartography Canvas Renderer
 * High-performance, tactile cartographic rendering for lakes, rivers, urban footprints,
 * organic forest canopy textures, background towns, and road networks.
 */

export class CartographyLayer {
  constructor() {
    this.pathCache = new Map(); // svgStr -> Path2D instance
    this.cartographyData = null;
    this.forestPatternCanvas = null;

    // Layer Visibility Toggles
    this.showWater = true;
    this.showFarmland = true; // Urban footprints
    this.showForest = true;   // Tactile woodland canopy
    this.showTowns = true;    // Background towns
    this.showRoads = true;
    this.showStreets = true;

    // Opacity Sliders & Blending
    this.waterOpacity = 1.0;
    this.farmlandOpacity = 0.45;
    this.forestOpacity = 0.65;
    this.townsOpacity = 0.50;
    this.forestBlendMode = 'multiply';

    this.init();
  }

  async init() {
    this.forestPatternCanvas = this.createForestTexturePattern();
    try {
      const res = await fetch('../cartography.json');
      this.cartographyData = await res.json();
    } catch {
      // Graceful fallback
    }
  }

  /** Generates a subtle procedural stipple texture for tactile forest cartography */
  createForestTexturePattern() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Base forest green fill
    ctx.fillStyle = '#143621';
    ctx.fillRect(0, 0, 64, 64);

    // Subtle micro-stipple stippling
    for (let i = 0; i < 180; i++) {
      const x = Math.random() * 64;
      const y = Math.random() * 64;
      const r = 0.5 + Math.random() * 1.2;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(32, 78, 48, 0.4)' : 'rgba(8, 24, 14, 0.35)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
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

    // 3. Tactile Woodland & Forest Layer (Soft feathered blending over terrain relief)
    if (this.showForest && this.cartographyData && this.cartographyData.forest && this.cartographyData.forest.length) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);

      // Blend mode allows hillshade shadows & ridges to conform through forest
      ctx.globalCompositeOperation = this.forestBlendMode || 'multiply';
      ctx.globalAlpha = this.forestOpacity;

      // Apply soft edge feathering filter if supported
      if ('filter' in ctx && typeof ctx.filter === 'string') {
        ctx.filter = 'blur(1.2px)';
      }

      // Fill forest contours using texture pattern or organic theme color
      const pattern = this.forestPatternCanvas ? ctx.createPattern(this.forestPatternCanvas, 'repeat') : null;
      ctx.fillStyle = pattern || theme.forest || 'rgba(22, 58, 36, 0.65)';

      for (const forestPath of this.cartographyData.forest) {
        const path = this.getPath2D(forestPath);
        if (path) ctx.fill(path);
      }

      ctx.filter = 'none';
      ctx.restore();
    }

    // 4. Background Towns (Independent layer)
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

    // 5. Road Networks (Graph Edges with decoded shape & pace)
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
      ctx.strokeStyle = theme.roadMotorway || '#d94b36';
      ctx.lineWidth = Math.max(theme.roadWidthMotorway || 2.8, 1.2) / scaleX;
      this.drawShapeBatch(ctx, motorways);

      // Draw Trunks
      if (camera.current.w <= 1400) {
        ctx.strokeStyle = theme.roadTrunk || '#e6a13c';
        ctx.lineWidth = Math.max(theme.roadWidthTrunk || 2.0, 1.0) / scaleX;
        this.drawShapeBatch(ctx, trunks);
      }

      // Draw Primaries
      if (camera.current.w <= 800) {
        ctx.strokeStyle = theme.roadPrimary || '#5f6f82';
        ctx.lineWidth = Math.max(theme.roadWidthPrimary || 1.2, 0.8) / scaleX;
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
