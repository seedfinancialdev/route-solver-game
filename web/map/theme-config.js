/**
 * Map Engine Theme Configuration & Aesthetic Styling Tokens
 * Sourced & tuned for Tactical Race Navigation & Educational Geographic Realism.
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
    meadow: 'rgba(58, 84, 45, 0.40)',
    terrainOpacity: 0.70,
    terrainBlend: 'multiply',
    roadMotorway: '#d94b36',
    roadTrunk: '#e6a13c',
    roadPrimary: '#5f6f82',
    roadSecondary: '#3e4a57',
    roadWidthMotorway: 2.8,
    roadWidthTrunk: 2.0,
    roadWidthPrimary: 1.2,
    cityNode: '#ffffff',
    cityNodeBorder: '#0b0f17',
    cityNodeActive: '#00f0ff',
    routeLine: '#00f0ff',
    routeLineGlow: 'rgba(0, 240, 255, 0.35)',
    hudGlass: 'rgba(12, 18, 25, 0.85)',
    hudText: '#e1e7ed',
  },
  tacticalDark: {
    name: 'Tactical Dark',
    bg: '#0c1a28',
    water: '#14344d',
    land: '#18202a',
    coastline: 'rgba(255, 255, 255, 0.65)',
    borderWidth: 1.6,
    forest: 'rgba(20, 56, 35, 0.75)',
    farmland: 'rgba(105, 88, 48, 0.52)',
    meadow: 'rgba(58, 84, 45, 0.45)',
    terrainOpacity: 0.65,
    terrainBlend: 'multiply',
    roadMotorway: '#d94b36',
    roadTrunk: '#e6a13c',
    roadPrimary: '#5f6f82',
    roadSecondary: '#3e4a57',
    roadWidthMotorway: 2.8,
    roadWidthTrunk: 2.0,
    roadWidthPrimary: 1.2,
    cityNode: '#ffffff',
    cityNodeBorder: '#0b0f17',
    cityNodeActive: '#00f0ff',
    routeLine: '#00f0ff',
    routeLineGlow: 'rgba(0, 240, 255, 0.35)',
    hudGlass: 'rgba(15, 20, 28, 0.82)',
    hudText: '#e1e7ed',
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
    meadow: 'rgba(70, 90, 50, 0.40)',
    terrainOpacity: 0.75,
    terrainBlend: 'overlay',
    roadMotorway: '#e66b4e',
    roadTrunk: '#cca152',
    roadPrimary: '#737a85',
    roadSecondary: '#4d5159',
    roadWidthMotorway: 3.0,
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
    meadow: 'rgba(45, 75, 50, 0.40)',
    terrainOpacity: 0.60,
    terrainBlend: 'source-over',
    roadMotorway: '#e63946',
    roadTrunk: '#f4a261',
    roadPrimary: '#457b9d',
    roadSecondary: '#2a9d8f',
    roadWidthMotorway: 2.6,
    roadWidthTrunk: 1.8,
    roadWidthPrimary: 1.1,
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
  }

  set(key, value) {
    this.current[key] = value;
  }

  loadPreset(name) {
    if (THEME_PRESETS[name]) {
      this.current = { ...THEME_PRESETS[name] };
    }
  }
}
