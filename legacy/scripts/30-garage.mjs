// The garage, priced.
//
// Performance points are minutes this car saves over the baseline on the
// reference race, so a regulation capping them says something you can read out
// loud. Range is compared at one pace for every car — see REFERENCE_KMH — and
// the top-speed term only pays on the 19,029 km of derestricted autobahn that
// measurement 8 found.
//
// Usage: npm run garage
//        npm run garage -- aux-tank,tune     (price the whole table modified)

import { loadCars, cruiseKmh, rangeKm, consumptionAt, performancePoints, applyMods,
  dominated, MODS, REFERENCE_KMH } from './lib/cars.mjs';

const mods = (process.argv[2] || '').split(',').filter(Boolean);
const all = loadCars();
const cars = loadCars('data/cars.json', { drivable: true }).map((c) => (mods.length ? applyMods(c, mods) : c));

if (mods.length) console.log(`fitted: ${mods.map((m) => MODS[m].label).join(', ')}\n`);
console.log(`Range and consumption at ${REFERENCE_KMH} km/h; cruise is what the car holds on open autobahn.\n`);

let category = '';
for (const c of [...cars].sort((a, b) => a.category.localeCompare(b.category) || performancePoints(b) - performancePoints(a))) {
  if (c.category !== category) {
    category = c.category;
    console.log(`  ${category.toUpperCase()}`);
    console.log('    car                             year   cruise    range    L/100     PP');
  }
  console.log(`    ${c.name.padEnd(30)} ${String(c.year).padStart(4)}   `
    + `${String(cruiseKmh(c)).padStart(3)} km/h   ${rangeKm(c, REFERENCE_KMH).toFixed(0).padStart(4)} km   `
    + `${consumptionAt(c, REFERENCE_KMH).toFixed(1).padStart(5)}   ${String(performancePoints(c)).padStart(4)}`);
}

const pp = cars.map(performancePoints).sort((a, b) => a - b);
console.log(`\n  spread: ${pp[0]} to ${pp[pp.length - 1]} points`);
console.log(`  a 100 PP regulation admits ${pp.filter((p) => p <= 100).length} of ${pp.length} cars,`
  + ` 60 PP admits ${pp.filter((p) => p <= 60).length}`);

const beaten = dominated(cars);
console.log(beaten.length
  ? `\n  Beaten outright by a car in the same category — quicker AND longer-legged:\n`
    + beaten.map(({ car, by }) => `    ${car.name.padEnd(30)} loses to ${by.name}`).join('\n')
    + `\n\n  With only speed and range modelled, some domination is unavoidable. What`
    + `\n  un-dominates these is an axis we have not built: reliability, police`
    + `\n  attention, weather. Until then they are choices in name only.`
  : '\n  No car in any category is beaten outright by another. Every pick is a trade.');

const pending = all.filter((c) => c.status);
if (pending.length) {
  console.log(`\n  Not yet priceable: ${pending.map((c) => `${c.name} (${c.status})`).join(', ')}`);
}
