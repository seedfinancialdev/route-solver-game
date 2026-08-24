// Cars: what you bring, and what it is worth.
//
// The car was measured against the same test every other system faced — does it
// change which route wins — and it failed like the other eight. A supercar
// saves nine hours on a German-heavy plan and still finishes 22 hours behind,
// because the fastest plan is the shortest one and the fastest corridor already
// carries the most derestricted autobahn.
//
// What the car does change is TIME, and by a lot:
//
//   150 -> 260 km/h sustained    1h48 on a 35 h race
//   350 -> 1,000 km of range     2h29 in fuel stops
//
// Those pull against each other, because a car driven fast empties its tank
// sooner. That tension is the mechanic. Range is worth more than speed on a
// long race, which is why real cannonball teams run diesel wagons.
//
// DATA BUCKETS, per docs/superpowers/specs/2026-08-23-system-coupling-findings.md
//
//   curated   tankL, wltpL100, topKmh, kerbKg — manufacturer-published figures
//             in data/cars.json, hand-maintained and verifiable.
//   modelled  everything in this file: what a car drinks at speed, what it will
//             actually hold for an hour, and what a modification does. Stated
//             parameters with a rationale, never presented to a player as fact.

import { readFileSync } from 'node:fs';

/** A car that saves nothing. Performance points are measured against it. */
export const BASELINE = { name: 'baseline', tankL: 40, wltpL100: 6.35, topKmh: 176, kerbKg: 1500 };

/**
 * What a car actually drinks at a sustained speed, litres per 100 km.
 *
 * MODELLED. The lab figure is measured over a cycle that averages well under
 * 100 km/h, and drag rises with the square of speed, so a real cannonball pace
 * costs far more than the brochure. Anchored on three points a driver would
 * recognise: about 1.35x the lab figure at 130, 2.2x at 200, 3x at 250.
 */
export function consumptionAt(car, kmh) {
  if (car.status) throw new Error(`${car.id ?? car.name} has no cost model yet (${car.status})`);
  return car.wltpL100 * (0.6 + 0.75 * (kmh / 130) ** 1.8);
}

/**
 * The speed a car will actually hold for an hour on empty derestricted road.
 *
 * MODELLED. Well under the brochure top speed: that number is a brief run in
 * ideal conditions, and a sustained cruise is limited by traffic, surface and
 * nerve. Capped at 240 because past that nobody holds it on a public road
 * however fast the car is.
 */
export function cruiseKmh(car) {
  return Math.min(Math.round(car.topKmh * 0.85), 240);
}

/** How far a tank goes at a given sustained speed. */
export function rangeKm(car, kmh = null) {
  return (car.tankL / consumptionAt(car, kmh ?? cruiseKmh(car))) * 100;
}

// How much a minute of each is worth, taken from the measurements rather than
// chosen: 110 km/h of extra cruise saved 108 minutes, and 650 km of extra range
// saved 149 minutes, both on the reference race.
const MIN_PER_KMH = 108 / 110;
const MIN_PER_RANGE_KM = 149 / 650;

/**
 * The pace range is compared at.
 *
 * Range has to be measured at ONE speed for every car or a fast car is charged
 * twice — once for drinking more, and again for having its range computed at a
 * higher speed than a slow car's. Nobody holds 240 km/h for four thousand
 * kilometres anyway; 180 is a hard but sustainable transcontinental pace, and
 * it is where a tank size is actually felt.
 */
export const REFERENCE_KMH = 180;

/**
 * A single number for a race regulation to cap, in the same spirit as Gran
 * Turismo's PP rating.
 *
 * It is not an abstract score: it is **minutes this car saves over the baseline
 * on the reference race**, so a 550 PP limit has a meaning you can say out loud.
 * The two terms are weighted by what each was measured to be worth, which is
 * why a big tank outscores a big engine.
 *
 * Calibrated on the Grand Tour, which carries 641 km of derestricted autobahn.
 * A race with much more or much less would weight speed differently.
 */
export function performancePoints(car) {
  const speed = (cruiseKmh(car) - cruiseKmh(BASELINE)) * MIN_PER_KMH;
  const range = (rangeKm(car, REFERENCE_KMH) - rangeKm(BASELINE, REFERENCE_KMH)) * MIN_PER_RANGE_KM;
  return Math.round(speed + range);
}

/**
 * Cars that are beaten outright by another in the same category — quicker AND
 * longer-legged, so there is never a reason to take them.
 *
 * With only two axes in the model some domination is unavoidable, and what
 * un-dominates a car is an axis we have not built: reliability, police
 * attention, weather capability. Reported rather than hidden, so the gap is
 * visible while those systems are missing.
 */
export function dominated(cars) {
  const out = [];
  for (const car of cars) {
    const by = cars.find((other) => other !== car
      && other.category === car.category
      && cruiseKmh(other) >= cruiseKmh(car)
      && rangeKm(other, REFERENCE_KMH) >= rangeKm(car, REFERENCE_KMH)
      && (cruiseKmh(other) > cruiseKmh(car) || rangeKm(other, REFERENCE_KMH) > rangeKm(car, REFERENCE_KMH)));
    if (by) out.push({ car, by });
  }
  return out;
}

/**
 * Modifications. MODELLED, every one of them.
 *
 * Each buys one thing and charges for another, so spending a regulation's
 * points is a trade rather than a purchase.
 */
export const MODS = {
  'aux-tank': { label: 'auxiliary tank', tankL: +45, kerbKg: +38 },
  'long-range-tank': { label: 'long-range tank', tankL: +80, kerbKg: +64 },
  tune: { label: 'ECU remap', topKmh: +18, wltpL100: +0.12, kerbKg: 0 },
  derestrict: { label: 'limiter removed', topKmh: +55, wltpL100: 0, kerbKg: 0 },
  aero: { label: 'aero package', topKmh: +8, wltpL100: -0.25, kerbKg: +12 },
  weight: { label: 'stripped interior', kerbKg: -85, wltpL100: -0.2 },
};

/** Apply modifications to a car, returning a new one. Order does not matter. */
export function applyMods(car, mods = []) {
  const out = { ...car, mods: [...mods] };
  for (const key of mods) {
    const mod = MODS[key];
    if (!mod) throw new Error(`unknown modification "${key}"`);
    for (const field of ['tankL', 'wltpL100', 'topKmh', 'kerbKg']) {
      if (mod[field]) out[field] = out[field] + mod[field];
    }
  }
  return out;
}

/**
 * The car table.
 *
 * `drivable` excludes anything still waiting on a model — the electric car
 * needs a charging-stop model before it can be priced, and returning NaN for it
 * would be worse than leaving it out.
 */
export function loadCars(path = 'data/cars.json', { drivable = false } = {}) {
  const cars = JSON.parse(readFileSync(path, 'utf8')).cars;
  return drivable ? cars.filter((c) => !c.status) : cars;
}
