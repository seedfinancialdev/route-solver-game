/**
 * Tactical Gameplay Overlay Canvas Renderer
 * Renders city nodes, reachable hop candidates, active route lines, glows, labels,
 * and tactical HUD indicators on top of the cartographic canvas.
 */

export class GameplayLayer {
  constructor() {
    this.hoveredCityId = null;
    this.selectedCityId = null;
    this.activeRoute = []; // list of city indices

    this.showNodes = true;
    this.showLabels = true;
    this.showCountryLimits = true;
  }

  render(ctx, camera, theme, g) {
    if (!g || !g.cities) return;

    ctx.save();

    // 1. Draw Active Route Trajectory with Glow Effect
    if (this.activeRoute.length > 1) {
      this.renderActiveRoute(ctx, camera, theme, g);
    }

    // 2. Draw City Nodes
    if (this.showNodes) {
      this.renderCityNodes(ctx, camera, theme, g);
    }

    // 3. Draw Tactical Labels (Start, Target, Hovered, Country Labels)
    if (this.showLabels) {
      this.renderLabels(ctx, camera, theme, g);
    }

    ctx.restore();
  }

  renderActiveRoute(ctx, camera, theme, g) {
    ctx.strokeStyle = theme.routeLineGlow;
    ctx.lineWidth = 8.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    for (let i = 0; i < this.activeRoute.length; i++) {
      const cityIdx = this.activeRoute[i];
      const city = g.cities[cityIdx];
      if (!city) continue;
      const p = camera.worldToScreen(city.x, city.y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Inner crisp route line
    ctx.strokeStyle = theme.routeLine;
    ctx.lineWidth = 3.0;
    ctx.stroke();
  }

  renderCityNodes(ctx, camera, theme, g) {
    const isZoomedClose = camera.current.w <= 400;

    for (const city of g.cities) {
      const p = camera.worldToScreen(city.x, city.y);

      // Frustum culling
      if (p.x < -20 || p.x > camera.viewportWidth + 20 || p.y < -20 || p.y > camera.viewportHeight + 20) continue;

      const isHovered = city.i === this.hoveredCityId;
      const isSelected = city.i === this.selectedCityId;

      let radius = isZoomedClose ? 5.0 : 3.5;
      if (isHovered) radius += 3.0;
      if (isSelected) radius += 2.0;

      // Draw outer glow for hovered node
      if (isHovered || isSelected) {
        ctx.fillStyle = theme.cityNodeActive;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      // Border circle
      ctx.fillStyle = theme.cityNodeBorder;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Inner fill node
      ctx.fillStyle = isHovered || isSelected ? theme.cityNodeActive : theme.cityNode;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  renderLabels(ctx, camera, theme, g) {
    const dpr = window.devicePixelRatio || 1;
    ctx.font = '600 11px "Inter", -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';

    const isClose = camera.current.w <= 1200;

    // 1. Country Labels
    if (g.countryLabels && camera.current.w > 600) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.font = '700 12px "Inter", sans-serif';
      for (const country of g.countryLabels) {
        const p = camera.worldToScreen(country.x, country.y);
        if (p.x < 0 || p.x > camera.viewportWidth || p.y < 0 || p.y > camera.viewportHeight) continue;
        ctx.fillText(country.name.toUpperCase(), p.x, p.y);
      }
    }

    // 2. City Labels
    ctx.font = '600 11px "Inter", -apple-system, system-ui, sans-serif';
    for (const city of g.cities) {
      if (!isClose && city.i !== this.hoveredCityId && city.i !== this.selectedCityId) continue;

      const p = camera.worldToScreen(city.x, city.y);
      if (p.x < 0 || p.x > camera.viewportWidth || p.y < 0 || p.y > camera.viewportHeight) continue;

      const labelText = city.name;
      const metrics = ctx.measureText(labelText);
      const textW = metrics.width + 12;
      const textH = 18;

      // Dark glassmorphism pill background
      ctx.fillStyle = theme.hudGlass;
      ctx.beginPath();
      ctx.roundRect(p.x - textW / 2, p.y - 22 - textH / 2, textW, textH, 4);
      ctx.fill();

      // Text label
      ctx.fillStyle = city.i === this.hoveredCityId ? theme.cityNodeActive : theme.hudText;
      ctx.fillText(labelText, p.x, p.y - 18);
    }
  }
}
