/**
 * Map Studio Interactive Controller
 * Binds control panel sliders, theme selectors, and layer toggles directly to MapEngine,
 * with real-time OpenStreetMap / Google Maps dynamic dual-unit cartographic scale bar.
 */

import { MapEngine } from '../map/map-engine.js';

const viewport = document.getElementById('studio-viewport');
const mapEngine = new MapEngine(viewport, '../data.json');

// DOM Elements
const fpsCounter = document.getElementById('fps-counter');
const presetSelect = document.getElementById('preset-select');
const forestBlendSelect = document.getElementById('forest-blend-select');

// Vector Layer Toggles
const toggleTerrain = document.getElementById('toggle-terrain');
const toggleWater = document.getElementById('toggle-water');
const toggleShoreline = document.getElementById('toggle-shoreline');
const toggleForest = document.getElementById('toggle-forest');
const toggleFarmland = document.getElementById('toggle-farmland');
const toggleRoads = document.getElementById('toggle-roads');
const toggleNodes = document.getElementById('toggle-nodes');

// Sliders
const sliderTerrain = document.getElementById('slider-terrain');
const sliderForest = document.getElementById('slider-forest');
const sliderWater = document.getElementById('slider-water');
const sliderRiver = document.getElementById('slider-river');
const sliderFarmland = document.getElementById('slider-farmland');

const valTerrain = document.getElementById('val-terrain');
const valForest = document.getElementById('val-forest');
const valWater = document.getElementById('val-water');
const valRiver = document.getElementById('val-river');
const valFarmland = document.getElementById('val-farmland');

// Scale Bar DOM
const scaleKmText = document.getElementById('scale-km-text');
const scaleKmLine = document.getElementById('scale-km-line');
const scaleMiText = document.getElementById('scale-mi-text');
const scaleMiLine = document.getElementById('scale-mi-line');
const statTier = document.getElementById('stat-tier');

// Bind Theme Selector
presetSelect.addEventListener('change', (e) => {
  mapEngine.themeManager.loadPreset(e.target.value);
  const cur = mapEngine.themeManager.current;
  sliderTerrain.value = Math.round((cur.terrainOpacity || 0.70) * 100);
  valTerrain.textContent = `${sliderTerrain.value}%`;
});

// Bind Forest Blend Mode Selector
forestBlendSelect.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.forestBlendMode = e.target.value;
});

// Bind Vector Toggles
toggleTerrain.addEventListener('change', (e) => {
  mapEngine.terrainLayer.showTerrain = e.target.checked;
});
toggleWater.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showWater = e.target.checked;
});
toggleShoreline.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showShoreline = e.target.checked;
});
toggleForest.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showForest = e.target.checked;
  mapEngine.terrainLayer.showForestRaster = e.target.checked;
});
toggleFarmland.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showFarmland = e.target.checked;
});
toggleRoads.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showRoads = e.target.checked;
});
toggleNodes.addEventListener('change', (e) => {
  mapEngine.gameplayLayer.showNodes = e.target.checked;
  mapEngine.gameplayLayer.showLabels = e.target.checked;
});

// Bind Sliders
sliderTerrain.addEventListener('input', (e) => {
  const val = e.target.value / 100;
  mapEngine.themeManager.set('terrainOpacity', val);
  valTerrain.textContent = `${e.target.value}%`;
});
sliderForest.addEventListener('input', (e) => {
  const val = e.target.value / 100;
  mapEngine.cartographyLayer.forestOpacity = val;
  valForest.textContent = `${e.target.value}%`;
});
sliderWater.addEventListener('input', (e) => {
  const val = e.target.value / 100;
  mapEngine.cartographyLayer.waterOpacity = val;
  valWater.textContent = `${e.target.value}%`;
});
sliderRiver.addEventListener('input', (e) => {
  const val = (e.target.value / 10).toFixed(1);
  mapEngine.cartographyLayer.riverWidthScale = parseFloat(val);
  valRiver.textContent = `${val}x`;
});
sliderFarmland.addEventListener('input', (e) => {
  const val = e.target.value / 100;
  mapEngine.cartographyLayer.farmlandOpacity = val;
  valFarmland.textContent = `${e.target.value}%`;
});

// Standard Cartographic Interval Sets
const KM_INTERVALS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const MI_INTERVALS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

// Update HUD & FPS stats loop (Dynamic Dual-Unit Scale Bar)
setInterval(() => {
  fpsCounter.textContent = `${mapEngine.fps} FPS`;

  const zoomKm = mapEngine.camera.current.w;
  const vpWidth = mapEngine.camera.viewportWidth || 1000;
  const kmPerPx = zoomKm / vpWidth;
  const miPerPx = (zoomKm * 0.621371) / vpWidth;

  // 1. Calculate KM Scale Bar
  let bestKm = KM_INTERVALS[0];
  for (const k of KM_INTERVALS) {
    const px = k / kmPerPx;
    if (px <= 110 && px >= 45) {
      bestKm = k;
      break;
    }
    if (px < 45) {
      bestKm = k;
      break;
    }
  }
  const kmWidthPx = Math.max(30, Math.round(bestKm / kmPerPx));
  scaleKmText.textContent = `${bestKm} km`;
  scaleKmLine.style.width = `${kmWidthPx}px`;

  // 2. Calculate MI Scale Bar
  let bestMi = MI_INTERVALS[0];
  for (const m of MI_INTERVALS) {
    const px = m / miPerPx;
    if (px <= 95 && px >= 38) {
      bestMi = m;
      break;
    }
    if (px < 38) {
      bestMi = m;
      break;
    }
  }
  const miWidthPx = Math.max(25, Math.round(bestMi / miPerPx));
  scaleMiText.textContent = `${bestMi} mi`;
  scaleMiLine.style.width = `${miWidthPx}px`;

  // 3. Zoom Tier Label
  let tier = 'Tier 1: Continental Overview';
  if (zoomKm <= 400) tier = 'Tier 3: Tactical Hub';
  else if (zoomKm <= 1400) tier = 'Tier 2: Regional Stage';
  statTier.textContent = tier;
}, 100);
