/**
 * Vector Cartography Canvas Renderer
 * High-performance, tactile cartographic rendering for crisp country borders,
 * lakes, rivers, 24-hour day/night urban night lights, dual-cased asphalt road networks,
 * and European Highway Shields / Alpine Pass Waypoints.
 */

// Iconic Alpine Passes & Cannonball Strategic Chokepoints (Real Lambert Proj Coordinates)
const STRATEGIC_WAYPOINTS = [
  { name: 'St. Gotthard Pass', alt: '2,106m', x: -487.7, y: 576.1, kind: 'pass' },
  { name: 'Brenner Pass', alt: '1,370m', x: -262.6, y: 542.2, kind: 'pass' },
  { name: 'Mont Blanc Tunnel', alt: '1,274m', x: -624.1, y: 635.2, kind: 'tunnel' },
  { name: 'Stelvio Pass', alt: '2,757m', x: -344.8, y: 590.5, kind: 'pass' },
  { name: 'San Bernardino Pass', alt: '2,066m', x: -442.1, y: 586.9, kind: 'pass' },
  { name: 'Simplon Pass', alt: '2,005m', x: -530.8, y: 606.3, kind: 'pass' },
  { name: 'Great St Bernard Pass', alt: '2,469m', x: -600.9, y: 641.4, kind: 'pass' },
  { name: 'Großglockner Pass', alt: '2,504m', x: -161.9, y: 538.8, kind: 'pass' },
  { name: 'Col de Turini', alt: '1,604m', x: -606.1, y: 851.3, kind: 'pass' },
];

export class CartographyLayer {
  constructor() {
    this.pathCache = new Map(); // svgStr -> Path2D instance

    // Layer Visibility Toggles
    this.showCoastlines = true; // Country & coastline boundaries
    this.showWater = true;      // Lakes & Rivers
    this.showFarmland = true;   // Urban footprints / Night Lights
    this.showForest = true;     // Raster forest layer toggle
    this.showTowns = true;      // Background towns
    this.showRoads = true;      // Road networks
    this.showShields = true;    // Highway route shields & Alpine pass badges
    this.showShoreline = true;  // Lake shoreline highlights

    // Opacity & Width Controls
    this.waterOpacity = 1.0;
    this.farmlandOpacity = 0.40;
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
    const nightFactor = theme.nightFactor !== undefined ? theme.nightFactor : 0.85;

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

    // 3. Day/Night Dynamic Urban Sprawl & Metropolitan Night Lights
    if (this.showFarmland && g.urbanAreas && g.urbanAreas.length) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);

      // Daytime Base Concrete
      if (nightFactor < 0.9) {
        ctx.fillStyle = theme.urbanDay || 'rgba(145, 130, 110, 0.40)';
        ctx.globalAlpha = this.farmlandOpacity * (1.0 - nightFactor);
        for (const areaPath of g.urbanAreas) {
          const path = this.getPath2D(areaPath);
          if (path) ctx.fill(path);
        }
      }

      // Nighttime Glowing Streetlights (NASA Black Marble Sprawl)
      if (nightFactor > 0.1) {
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = theme.urbanNight || 'rgba(255, 175, 55, 0.75)';
        ctx.globalAlpha = this.farmlandOpacity * nightFactor * (zoomKm <= 600 ? 1.0 : 0.75);

        for (const areaPath of g.urbanAreas) {
          const path = this.getPath2D(areaPath);
          if (path) ctx.fill(path);
        }

        // Outer Urban Radiance
        ctx.fillStyle = theme.urbanGlow || 'rgba(255, 150, 30, 0.35)';
        ctx.globalAlpha = 0.25 * nightFactor;
        ctx.lineWidth = 4.0 / scaleX;
        for (const areaPath of g.urbanAreas) {
          const path = this.getPath2D(areaPath);
          if (path) ctx.stroke(path);
        }
      }
      ctx.restore();
    }

    // 4. Background Towns (Visible in Regional/Hub zoom <= 900 km)
    if (this.showTowns && g.towns && g.towns.length && zoomKm <= 900) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.fillStyle = nightFactor > 0.5 ? 'rgba(255, 210, 120, 0.75)' : 'rgba(215, 195, 155, 0.65)';
      ctx.globalAlpha = this.townsOpacity;

      for (const town of g.towns) {
        const r = (town.tier === 1 ? 2.4 : 1.6) / scaleX;
        ctx.beginPath();
        ctx.arc(town.x, town.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 5. Road Networks (Dual-Carriageway Cased Asphalt Highways)
    if (this.showRoads && g.adj) {
      ctx.save();
      ctx.setTransform(scaleX * dpr, 0, 0, scaleY * dpr, translateX * dpr, translateY * dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

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

      let mwWidth = 3.2;
      let trWidth = 2.2;
      let prWidth = 1.4;

      if (zoomKm > 2000) {
        mwWidth = 0.8;
      } else if (zoomKm > 1000) {
        mwWidth = 1.6;
        trWidth = 1.1;
      } else if (zoomKm <= 400) {
        mwWidth = 4.2;
        trWidth = 2.8;
        prWidth = 1.6;
      }

      const casingCol = theme.roadCasing || '#080c14';

      // PASS 1: Dark Asphalt Roadbed Under-Casing
      if (zoomKm <= 1800) {
        ctx.strokeStyle = casingCol;

        if (zoomKm <= 900) {
          ctx.lineWidth = (prWidth + 1.2) / scaleX;
          this.drawShapeBatch(ctx, primaries);
        }

        ctx.lineWidth = (trWidth + 1.4) / scaleX;
        this.drawShapeBatch(ctx, trunks);

        ctx.lineWidth = (mwWidth + 1.8) / scaleX;
        this.drawShapeBatch(ctx, motorways);
      }

      // PASS 2: Vibrant Highway Surface Core
      if (zoomKm <= 900) {
        ctx.strokeStyle = theme.roadPrimary || '#6b7c93';
        ctx.lineWidth = prWidth / scaleX;
        this.drawShapeBatch(ctx, primaries);
      }

      if (zoomKm <= 1800) {
        ctx.strokeStyle = theme.roadTrunk || '#e6a13c';
        ctx.lineWidth = trWidth / scaleX;
        this.drawShapeBatch(ctx, trunks);
      }

      const isOverview = zoomKm > 2000;
      ctx.strokeStyle = isOverview ? 'rgba(230, 81, 51, 0.45)' : (theme.roadMotorway || '#e65133');
      ctx.lineWidth = mwWidth / scaleX;
      this.drawShapeBatch(ctx, motorways);

      // PASS 3: Dual-Lane Centerline Divider (Zoom <= 350 km)
      if (zoomKm <= 350) {
        ctx.strokeStyle = casingCol;
        ctx.lineWidth = 0.8 / scaleX;
        this.drawShapeBatch(ctx, motorways);
      }

      ctx.restore();
    }

    // 6. European Highway Route Shields & Strategic Alpine Pass Waypoints (Zoom <= 850 km)
    if (this.showShields && zoomKm <= 850) {
      this.renderHighwayShieldsAndWaypoints(ctx, camera, theme, g, dpr);
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

  renderHighwayShieldsAndWaypoints(ctx, camera, theme, g, dpr) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const renderedShields = new Set();

    // A. Render Highway Shields
    for (const cityEdges of g.adj) {
      for (const edge of cityEdges) {
        if (!edge.road || !edge.road.label || !edge.shape || edge.shape.length < 4) continue;
        const label = edge.road.label.trim();
        if (renderedShields.has(label)) continue;

        // Find midpoint along shape
        const midIdx = Math.floor(edge.shape.length / 2);
        const pt = edge.shape[midIdx];
        const screenPos = camera.worldToScreen(pt[0], pt[1]);

        if (screenPos.x < 20 || screenPos.x > camera.viewportWidth - 20 ||
            screenPos.y < 20 || screenPos.y > camera.viewportHeight - 20) {
          continue;
        }

        let badgeBg = '#1d4ed8'; // Blue for Motorways (A1, A8, M1, AP-9)
        let badgeBorder = '#3b82f6';
        let badgeText = '#ffffff';

        if (label.startsWith('E') || label.startsWith('E-')) {
          badgeBg = '#15803d'; // Green for International E-Routes
          badgeBorder = '#22c55e';
        } else if (label.startsWith('N') || label.startsWith('D') || label.startsWith('B') || label.startsWith('SS')) {
          badgeBg = '#334155'; // Slate for National Trunks
          badgeBorder = '#64748b';
        }

        ctx.font = 'bold 9px "Inter", sans-serif';
        const textWidth = ctx.measureText(label).width;
        const badgeW = textWidth + 8;
        const badgeH = 14;
        const bx = screenPos.x - badgeW / 2;
        const by = screenPos.y - badgeH / 2;

        ctx.fillStyle = badgeBg;
        ctx.strokeStyle = badgeBorder;
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.roundRect(bx, by, badgeW, badgeH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = badgeText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, screenPos.x, screenPos.y + 0.5);

        renderedShields.add(label);
      }
    }

    // B. Render Strategic Alpine Passes & Chokepoints (Real Coordinates)
    for (const wp of STRATEGIC_WAYPOINTS) {
      const pos = camera.worldToScreen(wp.x, wp.y);
      if (pos.x < 20 || pos.x > camera.viewportWidth - 20 ||
          pos.y < 20 || pos.y > camera.viewportHeight - 20) {
        continue;
      }

      const isTunnel = wp.kind === 'tunnel';
      const label = isTunnel ? `🚇 ${wp.name} (${wp.alt})` : `▲ ${wp.name} (${wp.alt})`;
      ctx.font = '700 9px "Inter", sans-serif';
      const tw = ctx.measureText(label).width;
      const bw = tw + 12;
      const bh = 18;

      // Draw Pass/Tunnel Badge
      ctx.fillStyle = isTunnel ? 'rgba(12, 74, 110, 0.90)' : 'rgba(15, 23, 42, 0.90)';
      ctx.strokeStyle = isTunnel ? '#38bdf8' : '#f59e0b';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.roundRect(pos.x - bw / 2, pos.y - bh / 2, bw, bh, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isTunnel ? '#e0f2fe' : '#fbbf24';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x, pos.y);
    }

    ctx.restore();
  }
}
