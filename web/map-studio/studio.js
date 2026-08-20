/**
 * Map Studio Interactive Controller
 * Binds control panel sliders, theme selectors, and 24-hour solar time-of-day controls directly to MapEngine.
 */

import { MapEngine } from '../map/map-engine.js';

const viewport = document.getElementById('studio-viewport');
const mapEngine = new MapEngine(viewport, '../data.json');

// DOM Elements
const fpsCounter = document.getElementById('fps-counter');
const presetSelect = document.getElementById('preset-select');
const forestBlendSelect = document.getElementById('forest-blend-select');

// 24-Hour Solar Time of Day Elements
const sliderTime = document.getElementById('slider-time');
const rallyClock = document.getElementById('rally-clock');
const btnNoon = document.getElementById('btn-time-noon');
const btnDusk = document.getElementById('btn-time-dusk');
const btnNight = document.getElementById('btn-time-night');
const btnDawn = document.getElementById('btn-time-dawn');
const timeBtns = [btnNoon, btnDusk, btnNight, btnDawn];

// Vector & Raster Layer Toggles
const toggleTerrain = document.getElementById('toggle-terrain');
const toggleWater = document.getElementById('toggle-water');
const toggleForest = document.getElementById('toggle-forest');
const toggleUrbanSat = document.getElementById('toggle-urban-sat');
const toggleRoads = document.getElementById('toggle-roads');
const toggleShields = document.getElementById('toggle-shields');
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

// 24-Hour Solar Clock Logic
function setSolarTime(hour, activeBtn = null) {
  mapEngine.themeManager.setTimeOfDay(hour);
  sliderTime.value = hour;

  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const hStr = String(h).padStart(2, '0');
  const mStr = String(m).padStart(2, '0');
  rallyClock.textContent = `${hStr}:${mStr} CET`;

  timeBtns.forEach(b => b.classList.remove('active'));
  if (activeBtn) activeBtn.classList.add('active');
}

sliderTime.addEventListener('input', (e) => {
  const h = parseFloat(e.target.value);
  setSolarTime(h);
});

btnNoon.addEventListener('click', () => {
  mapEngine.themeManager.loadPreset('satelliteTopo');
  presetSelect.value = 'satelliteTopo';
  setSolarTime(12.0, btnNoon);
});

btnDusk.addEventListener('click', () => {
  setSolarTime(19.5, btnDusk);
});

btnNight.addEventListener('click', () => {
  mapEngine.themeManager.loadPreset('cannonballNight');
  presetSelect.value = 'cannonballNight';
  setSolarTime(22.0, btnNight);
});

btnDawn.addEventListener('click', () => {
  setSolarTime(6.0, btnDawn);
});

// Bind Theme Selector
presetSelect.addEventListener('change', (e) => {
  mapEngine.themeManager.loadPreset(e.target.value);
  const cur = mapEngine.themeManager.current;
  sliderTerrain.value = Math.round((cur.terrainOpacity || 0.65) * 100);
  valTerrain.textContent = `${sliderTerrain.value}%`;
});

// Bind Forest Blend Mode Selector
forestBlendSelect.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.forestBlendMode = e.target.value;
});

// Bind Vector & Raster Toggles
toggleTerrain.addEventListener('change', (e) => {
  mapEngine.terrainLayer.showTerrain = e.target.checked;
});
toggleWater.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showWater = e.target.checked;
});
toggleForest.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showForest = e.target.checked;
  mapEngine.terrainLayer.showForestRaster = e.target.checked;
});
toggleUrbanSat.addEventListener('change', (e) => {
  mapEngine.terrainLayer.showUrbanSatellite = e.target.checked;
  mapEngine.cartographyLayer.showFarmland = e.target.checked;
});
toggleRoads.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showRoads = e.target.checked;
});
toggleShields.addEventListener('change', (e) => {
  mapEngine.cartographyLayer.showShields = e.target.checked;
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

// Initialize 12:00 CET Natural Full-Color Physical Atlas (High Noon)
setSolarTime(12.0, btnNoon);

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
