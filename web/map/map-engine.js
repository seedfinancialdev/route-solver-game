/**
 * Core Map Engine Orchestrator
 * Integrates Camera, Terrain Relief, Raster Forest Maps, Vector Cartography, Gameplay Overlay,
 * and Theme Engine into a 60fps render loop.
 */

import { Camera } from './camera.js';
import { TerrainLayer } from './terrain-layer.js';
import { CartographyLayer } from './cartography-layer.js';
import { GameplayLayer } from './gameplay-layer.js';
import { MapTheme } from './theme-config.js';
import { buildGraph } from '../engine.js';

export class MapEngine {
  constructor(canvasContainer, dataUrl = '../data.json') {
    this.container = canvasContainer;
    this.dataUrl = dataUrl;

    // Create Canvas Element
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Default Map Bounds (Europe)
    this.worldBounds = { x: -2344.95, y: -2230.35, w: 4232, h: 4142.65 };

    // Subsystems
    this.camera = new Camera(this.container, this.worldBounds);
    this.themeManager = new MapTheme('tacticalDark');
    this.terrainLayer = new TerrainLayer(this.worldBounds);
    this.cartographyLayer = new CartographyLayer();
    this.gameplayLayer = new GameplayLayer();

    // Data & Graph State
    this.rawData = null;
    this.graphData = null;

    // Performance Monitoring
    this.fps = 60;
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();

    this.init();
  }

  async init() {
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    // Fetch Graph Data
    try {
      const res = await fetch(this.dataUrl);
      this.rawData = await res.json();
      this.graphData = buildGraph(this.rawData);

      if (this.graphData.view) {
        this.worldBounds = this.graphData.view;
        this.camera.worldBounds = this.worldBounds;
        this.camera.setFrame(
          this.worldBounds.x + this.worldBounds.w / 2,
          this.worldBounds.y + this.worldBounds.h / 2,
          this.worldBounds.w
        );
      }
    } catch (err) {
      console.warn('MapEngine: graph data fetch failed', err);
    }

    // Start Render Loop
    this.startLoop();
  }

  resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.camera.resize(rect.width, rect.height);
  }

  startLoop() {
    const loop = (timestamp) => {
      this.update(timestamp);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  update(timestamp) {
    this.camera.update();

    // Measure FPS
    this.frameCount++;
    if (timestamp - this.lastFpsUpdate >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (timestamp - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = timestamp;
    }
  }

  render() {
    const width = this.camera.viewportWidth;
    const height = this.camera.viewportHeight;
    const dpr = window.devicePixelRatio || 1;
    const theme = this.themeManager.current;

    // Reset Context & Clear Canvas with Background Color
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = theme.bg;
    this.ctx.fillRect(0, 0, width, height);

    // Render Layers in Order:
    // 1. Terrain Elevation Relief & Pre-Rendered Lambert Raster Forest Layer
    this.terrainLayer.render(
      this.ctx,
      this.camera,
      theme,
      this.cartographyLayer.forestOpacity,
      this.cartographyLayer.forestBlendMode
    );

    // 2. Vector Cartography (Lakes, rivers, urban footprints, road networks)
    this.cartographyLayer.render(this.ctx, this.camera, theme, this.graphData);

    // 3. Tactical Gameplay Overlay (City Nodes, Labels, Active Route)
    this.gameplayLayer.render(this.ctx, this.camera, theme, this.graphData);
  }
}
