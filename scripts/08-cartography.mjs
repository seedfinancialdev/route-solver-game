/**
 * Cartography Data Pipeline: Clean Regional Land Cover Features
 * Generates/formats localized forest & agricultural land use contours strictly bounded to physical geography.
 * Output: web/cartography.json
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { simplify } from './lib/simplify.mjs';

const DATA_FILE = new URL('../web/data.json', import.meta.url);
const OUTPUT_FILE = new URL('../web/cartography.json', import.meta.url);

console.log('Generating clean cartography land cover features...');

const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));

const forestPolygons = [];
const farmlandPolygons = [];

// Helper to create small, realistic, smooth closed organic land cover contour
function createLandContour(cx, cy, rx, ry, seed = 1) {
  // Cap max radius to prevent oversized shards
  rx = Math.min(Math.max(rx, 8), 35);
  ry = Math.min(Math.max(ry, 8), 25);

  const pts = [];
  const pointsCount = 14;
  for (let i = 0; i < pointsCount; i++) {
    const angle = (i / pointsCount) * Math.PI * 2;
    const noise = 0.8 + 0.3 * Math.sin(angle * 3 + seed);
    const x = Math.round(cx + Math.cos(angle) * rx * noise);
    const y = Math.round(cy + Math.sin(angle) * ry * noise);
    pts.push([x, y]);
  }
  const simplified = simplify(pts, 1.0);
  return `M${simplified.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
}

// Bounded local forest contours around relief features
if (data.physicalLabels) {
  data.physicalLabels.forEach(([name, x, y, kind], i) => {
    if (kind === 'relief' || kind === 'mountains' || kind === 'forest') {
      forestPolygons.push(createLandContour(x, y, 25, 18, i + 10));
      forestPolygons.push(createLandContour(x + 20, y - 12, 16, 12, i + 20));
    }
  });
}

// Bounded farmland contours around city basins
data.cities.forEach(([name, country, x, y], i) => {
  if (i % 3 === 0) {
    farmlandPolygons.push(createLandContour(x + 10, y + 10, 20, 15, i + 30));
  }
});

const cartographyData = {
  version: '1.0.0',
  forest: forestPolygons,
  farmland: farmlandPolygons,
};

writeFileSync(OUTPUT_FILE, JSON.stringify(cartographyData));
console.log(`Clean cartography generated: ${forestPolygons.length} forest contours, ${farmlandPolygons.length} farmland contours.`);
