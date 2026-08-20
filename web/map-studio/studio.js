/**
 * Map Studio Interactive Controller
 * Binds control panel sliders, theme selectors, and layer toggles directly to MapEngine.
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

const statZoom = document.getElementById('stat-zoom');
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

// Update HUD & FPS stats loop (3-Tier Zoom Hierarchy)
setInterval(() => {
  fpsCounter.textContent = `${mapEngine.fps} FPS`;

  const zoomKm = Math.round(mapEngine.camera.current.w);
  statZoom.textContent = `${zoomKm.toLocaleString()} km`;

  let tier = 'Tier 1: Continental (>1,400 km)';
  if (zoomKm <= 400) tier = 'Tier 3: Tactical Hub (140–400 km)';
  else if (zoomKm <= 1400) tier = 'Tier 2: Regional Stage (400–1,400 km)';
  statTier.textContent = tier;
}, 250);
