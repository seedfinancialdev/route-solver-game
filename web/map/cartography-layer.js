/**
 * Vector Cartography Canvas Renderer
 * High-performance, tactile cartographic rendering for crisp country borders,
 * lakes, rivers, urban footprints, background towns, and proportional road networks.
 */

export class CartographyLayer {
  constructor() {
    this.pathCache = new Map(); // svgStr -> Path2D instance

    // Layer Visibility Toggles
    this.showCoastlines = true; // Country & coastline boundaries
    this.showWater = true;      // Lakes & Rivers
    this.showFarmland = true;   // Urban footprints
    this.showForest = true;     // Raster forest layer toggle
    this.showTowns = true;      // Background towns
    this.showRoads = true;      // Road networks
    this.showShoreline = true;  // Lake shoreline highlights

    // Opacity & Width Controls
    this.waterOpacity = 1.0;
    this.farmlandOpacity = 0.35;
    this.forestOpacity = 0.65;
    this.townsOpacity = 0.50;
    this.riverWidthScale = 1.0;
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
    const zoomKm = camera.current.w;

    // 1. National Country Boundaries & Coastlines (Crisp Tactical White)
    if (this.showCoastlines && g.countries && g.countries.length) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);

      // Draw National Country Border Stroke (Crisp White)
      ctx.strokeStyle = theme.coastline || 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = (theme.borderWidth || 1.6) / scaleX;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (const countryPath of g.countries) {
        const path = this.getPath2D(countryPath);
        if (path) ctx.stroke(path);
      }
      ctx.restore();
    }

    // 2. Inland Water Bodies (Lakes & Clean Vector Rivers)
    if (this.showWater) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.globalAlpha = this.waterOpacity;

      // A. Lakes (Core Fill + Shoreline Ring)
      if (g.lakes && g.lakes.length) {
        ctx.fillStyle = theme.water || '#14344d';
        for (const lakePath of g.lakes) {
          const path = this.getPath2D(lakePath);
          if (path) ctx.fill(path);
        }

        if (this.showShoreline) {
          ctx.strokeStyle = 'rgba(80, 170, 230, 0.35)';
          ctx.lineWidth = 1.0 / scaleX;
          for (const lakePath of g.lakes) {
            const path = this.getPath2D(lakePath);
            if (path) ctx.stroke(path);
          }
        }
      }

      // B. Rivers (Clean 2-tier vector flow lines, zero fuzzy smudges)
      if (g.rivers && g.rivers.length) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Outer Channel Base
        ctx.strokeStyle = theme.water || '#14344d';
        ctx.lineWidth = (2.4 * this.riverWidthScale) / scaleX;
        for (const riverPath of g.rivers) {
          const path = this.getPath2D(riverPath);
          if (path) ctx.stroke(path);
        }

        // Inner Flow Core
        ctx.strokeStyle = 'rgba(60, 150, 210, 0.75)';
        ctx.lineWidth = (1.2 * this.riverWidthScale) / scaleX;
        for (const riverPath of g.rivers) {
          const path = this.getPath2D(riverPath);
          if (path) ctx.stroke(path);
        }
      }
      ctx.restore();
    }

    // 3. Urban Footprints (Built-up City Footprints - Enhanced inside 140–800 km)
    if (this.showFarmland && g.urbanAreas && g.urbanAreas.length) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.fillStyle = theme.farmland || 'rgba(162, 137, 92, 0.35)';
      ctx.globalAlpha = this.farmlandOpacity * (zoomKm <= 600 ? 1.0 : 0.7);

      for (const areaPath of g.urbanAreas) {
        const path = this.getPath2D(areaPath);
        if (path) ctx.fill(path);
      }
      ctx.restore();
    }

    // 4. Background Towns (Visible in Regional/Hub zoom <= 900 km)
    if (this.showTowns && g.towns && g.towns.length && zoomKm <= 900) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.fillStyle = 'rgba(215, 195, 155, 0.65)';
      ctx.globalAlpha = this.townsOpacity;

      for (const town of g.towns) {
        const r = (town.tier === 1 ? 2.4 : 1.6) / scaleX;
        ctx.beginPath();
        ctx.arc(town.x, town.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 5. Road Networks (Proportionally anchored race tracks across zoom tiers)
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

      // Proportional width calculation anchored to zoom
      let mwWidth = 3.0;
      let trWidth = 2.0;
      let prWidth = 1.2;

      if (zoomKm > 2000) {
        mwWidth = 0.6;
      } else if (zoomKm > 1000) {
        mwWidth = 1.4;
        trWidth = 1.0;
      } else if (zoomKm <= 400) {
        mwWidth = 3.6;
        trWidth = 2.4;
        prWidth = 1.5;
      }

      // Draw Motorways
      const isOverview = zoomKm > 2000;
      ctx.strokeStyle = isOverview ? 'rgba(217, 75, 54, 0.40)' : (theme.roadMotorway || '#d94b36');
      ctx.lineWidth = mwWidth / scaleX;
      this.drawShapeBatch(ctx, motorways);

      // Draw Trunks
      if (zoomKm <= 1800) {
        ctx.strokeStyle = theme.roadTrunk || '#e6a13c';
        ctx.lineWidth = trWidth / scaleX;
        this.drawShapeBatch(ctx, trunks);
      }

      // Draw Primaries
      if (zoomKm <= 900) {
        ctx.strokeStyle = theme.roadPrimary || '#5f6f82';
        ctx.lineWidth = prWidth / scaleX;
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
