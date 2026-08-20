/**
 * Map Engine Theme Configuration & 24-Hour Solar Time-of-Day System
 * Sourced & tuned for Tactical Race Navigation & Cannonball Rally Realism.
 */

export const THEME_PRESETS = {
  satelliteTopo: {
    name: 'Satellite Topo (Default)',
    bg: '#0c1a28',
    water: '#14344d',
    land: '#18202a',
    coastline: 'rgba(255, 255, 255, 0.65)',
    borderWidth: 1.6,
    forest: 'rgba(20, 56, 35, 0.75)',
    farmland: 'rgba(162, 137, 92, 0.35)',
    urbanDay: 'rgba(145, 130, 110, 0.40)',
    urbanNight: 'rgba(255, 175, 55, 0.75)',
    urbanGlow: 'rgba(255, 150, 30, 0.35)',
    terrainOpacity: 0.70,
    terrainBlend: 'multiply',
    roadCasing: '#080c14',
    roadDivider: '#080c14',
    roadMotorway: '#e65133',
    roadTrunk: '#e6a13c',
    roadPrimary: '#6b7c93',
    roadSecondary: '#3e4a57',
    roadWidthMotorway: 3.2,
    roadWidthTrunk: 2.2,
    roadWidthPrimary: 1.4,
    cityNode: '#ffffff',
    cityNodeBorder: '#0b0f17',
    cityNodeActive: '#00f0ff',
    routeLine: '#00f0ff',
    routeLineGlow: 'rgba(0, 240, 255, 0.35)',
    hudGlass: 'rgba(12, 18, 25, 0.85)',
    hudText: '#e1e7ed',
  },
  cannonballNight: {
    name: 'Night Ops (Cannonball)',
    bg: '#060d15',
    water: '#0a1a27',
    land: '#0e141d',
    coastline: 'rgba(255, 255, 255, 0.50)',
    borderWidth: 1.4,
    forest: 'rgba(10, 35, 22, 0.85)',
    farmland: 'rgba(80, 65, 45, 0.30)',
    urbanDay: 'rgba(110, 100, 85, 0.30)',
    urbanNight: 'rgba(255, 185, 60, 0.85)',
    urbanGlow: 'rgba(255, 160, 35, 0.50)',
    terrainOpacity: 0.80,
    terrainBlend: 'multiply',
    roadCasing: '#04070b',
    roadDivider: '#04070b',
    roadMotorway: '#ff4d2e',
    roadTrunk: '#f59e0b',
    roadPrimary: '#475569',
    roadSecondary: '#1e293b',
    roadWidthMotorway: 3.4,
    roadWidthTrunk: 2.4,
    roadWidthPrimary: 1.5,
    cityNode: '#38bdf8',
    cityNodeBorder: '#020617',
    cityNodeActive: '#00f0ff',
    routeLine: '#00f0ff',
    routeLineGlow: 'rgba(0, 240, 255, 0.50)',
    hudGlass: 'rgba(8, 12, 18, 0.90)',
    hudText: '#f8fafc',
  },
  satelliteDay: {
    name: 'Daylight Topo (Noon)',
    bg: '#122c44',
    water: '#1b4566',
    land: '#232b35',
    coastline: 'rgba(255, 255, 255, 0.70)',
    borderWidth: 1.8,
    forest: 'rgba(28, 72, 45, 0.70)',
    farmland: 'rgba(175, 150, 105, 0.45)',
    urbanDay: 'rgba(165, 150, 130, 0.50)',
    urbanNight: 'rgba(255, 200, 90, 0.20)',
    urbanGlow: 'rgba(255, 180, 50, 0.10)',
    terrainOpacity: 0.60,
    terrainBlend: 'multiply',
    roadCasing: '#10151c',
    roadDivider: '#10151c',
    roadMotorway: '#d93b1d',
    roadTrunk: '#d98e28',
    roadPrimary: '#58697d',
    roadSecondary: '#3a4754',
    roadWidthMotorway: 3.0,
    roadWidthTrunk: 2.0,
    roadWidthPrimary: 1.3,
    cityNode: '#ffffff',
    cityNodeBorder: '#0b0f17',
    cityNodeActive: '#0284c7',
    routeLine: '#0284c7',
    routeLineGlow: 'rgba(2, 132, 199, 0.30)',
    hudGlass: 'rgba(15, 23, 34, 0.85)',
    hudText: '#f1f5f9',
  },
  vintageTopo: {
    name: 'Vintage Topo',
    bg: '#1b2c3a',
    water: '#224259',
    land: '#282420',
    coastline: 'rgba(25, 20, 15, 0.75)',
    borderWidth: 1.8,
    forest: 'rgba(34, 58, 38, 0.70)',
    farmland: 'rgba(120, 95, 50, 0.48)',
    urbanDay: 'rgba(130, 110, 80, 0.40)',
    urbanNight: 'rgba(255, 180, 60, 0.60)',
    urbanGlow: 'rgba(255, 150, 40, 0.30)',
    terrainOpacity: 0.75,
    terrainBlend: 'overlay',
    roadCasing: '#181410',
    roadDivider: '#181410',
    roadMotorway: '#e66b4e',
    roadTrunk: '#cca152',
    roadPrimary: '#737a85',
    roadSecondary: '#4d5159',
    roadWidthMotorway: 3.2,
    roadWidthTrunk: 2.2,
    roadWidthPrimary: 1.4,
    cityNode: '#f5e9d3',
    cityNodeBorder: '#141210',
    cityNodeActive: '#ff9d00',
    routeLine: '#ff9d00',
    routeLineGlow: 'rgba(255, 157, 0, 0.30)',
    hudGlass: 'rgba(30, 28, 25, 0.85)',
    hudText: '#f5e9d3',
  },
  nordicSlate: {
    name: 'Nordic Slate',
    bg: '#0a1724',
    water: '#102a40',
    land: '#131922',
    coastline: 'rgba(255, 255, 255, 0.70)',
    borderWidth: 1.6,
    forest: 'rgba(15, 48, 36, 0.80)',
    farmland: 'rgba(85, 78, 55, 0.45)',
    urbanDay: 'rgba(120, 130, 145, 0.40)',
    urbanNight: 'rgba(255, 190, 80, 0.70)',
    urbanGlow: 'rgba(255, 170, 50, 0.35)',
    terrainOpacity: 0.60,
    terrainBlend: 'source-over',
    roadCasing: '#060a0f',
    roadDivider: '#060a0f',
    roadMotorway: '#e63946',
    roadTrunk: '#f4a261',
    roadPrimary: '#457b9d',
    roadSecondary: '#2a9d8f',
    roadWidthMotorway: 3.0,
    roadWidthTrunk: 2.0,
    roadWidthPrimary: 1.3,
    cityNode: '#e0f2fe',
    cityNodeBorder: '#070a0e',
    cityNodeActive: '#38bdf8',
    routeLine: '#38bdf8',
    routeLineGlow: 'rgba(56, 189, 248, 0.35)',
    hudGlass: 'rgba(12, 16, 21, 0.85)',
    hudText: '#f0f9ff',
  }
};

export class MapTheme {
  constructor(initialPreset = 'satelliteTopo') {
    this.current = { ...THEME_PRESETS[initialPreset] };
    this.hour = 22.0; // Default: 22:00 (10:00 PM Cannonball Night Rally start)
  }

  set(key, value) {
    this.current[key] = value;
  }

  loadPreset(name) {
    if (THEME_PRESETS[name]) {
      this.current = { ...THEME_PRESETS[name] };
    }
  }

  setTimeOfDay(hour) {
    this.hour = Math.max(0, Math.min(24, hour));
    // Determine night factor: 1.0 at midnight (02:00), 0.0 at noon (12:00)
    let nightFactor = 0;
    if (this.hour >= 20 || this.hour <= 5) {
      nightFactor = 1.0; // Deep night
    } else if (this.hour > 5 && this.hour < 8) {
      nightFactor = (8 - this.hour) / 3; // Dawn transition
    } else if (this.hour > 17 && this.hour < 20) {
      nightFactor = (this.hour - 17) / 3; // Dusk transition
    } else {
      nightFactor = 0.0; // Broad daylight
    }

    this.current.nightFactor = nightFactor;
  }
}
