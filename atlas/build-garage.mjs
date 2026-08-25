// Emits the garage data the atlas serves as a real page.
//
// Same shape as build-geojson.mjs: read from data/, compute through the real
// library, write static JSON atlas/garage.html fetches at runtime. Every
// number here comes from scripts/lib/cars.mjs — the same functions the CLI
// garage report and the fuel/vehicle gates use — so what a player sees cannot
// drift from what the game actually computes. The browser never reimplements
// the model, including for mods: every legal build is priced here, not there.
//
// Output: atlas/garage.json

import { readFileSync, writeFileSync } from 'node:fs';
import {
  loadCars, cruiseKmh, rangeKm, consumptionAt, performancePoints, applyMods, legalModSets,
  REFERENCE_KMH, BASELINE, MODS,
} from '../scripts/lib/cars.mjs';

const raw = JSON.parse(readFileSync(new URL('../data/cars.json', import.meta.url), 'utf8'));
const all = loadCars();
const priceable = loadCars('data/cars.json', { drivable: true });
const BUILDS = legalModSets();

// Category label/brief are DERIVED from the one description in data/cars.json
// rather than duplicated here — "Executive autocruisers — the meta picks..."
// splits on the em dash into a title and the rest, so the copy has one source.
const categories = Object.entries(raw.categories).map(([key, text]) => {
  const [head, ...rest] = text.split(' — ');
  const label = head.replace(/\b\w/g, (c) => c.toUpperCase());
  const brief = rest.join(' — ');
  return { key, label, brief: brief.charAt(0).toUpperCase() + brief.slice(1) };
});

const mods = Object.fromEntries(Object.entries(MODS).map(([id, m]) => [id, { id, label: m.label }]));

const cars = all.map((c) => {
  const out = {
    id: c.id, name: c.name, year: c.year, category: c.category, fuel: c.fuel,
    topKmh: c.topKmh, kerbKg: c.kerbKg, partial: !!c.partial,
  };
  if (c.status) {
    out.status = c.status;
    out.batteryKwh = c.batteryKwh;
    out.kwhPer100 = c.kwhPer100;
  } else {
    out.tankL = c.tankL;
    out.wltpL100 = c.wltpL100;
    // Stock spec, for the collapsed card. Full builds[] below carries every
    // configuration, stock included (builds[0] is always the no-mods build).
    out.cruiseKmh = cruiseKmh(c);
    out.rangeKm = Math.round(rangeKm(c, REFERENCE_KMH));
    out.pp = performancePoints(c);
    out.builds = BUILDS.map((set) => {
      const built = applyMods(c, set);
      return {
        mods: set,
        tankL: built.tankL,
        cruiseKmh: cruiseKmh(built),
        rangeKm: Math.round(rangeKm(built, REFERENCE_KMH)),
        consumptionAt180: Math.round(consumptionAt(built, REFERENCE_KMH) * 10) / 10,
        pp: performancePoints(built),
      };
    });
  }
  return out;
});

const ppValues = cars.filter((c) => !c.status).flatMap((c) => c.builds.map((b) => b.pp));

writeFileSync(new URL('./garage.json', import.meta.url), JSON.stringify({
  generated: raw.generated,
  referenceKmh: REFERENCE_KMH,
  baseline: BASELINE,
  ppRange: [Math.min(...ppValues), Math.max(...ppValues)],
  categories,
  mods,
  cars,
}));
console.log(`${cars.length} cars, ${priceable.length * BUILDS.length} priced builds `
  + `(${BUILDS.length} configurations each)`);
