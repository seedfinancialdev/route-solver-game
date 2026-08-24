// The car model.
//
// Ten systems were measured against "does it change the route" and the car was
// not one of the two that passed. What it does change is TIME: 1h48 between a
// 150 and a 260 km/h cruise, and 2h29 between 350 and 1,000 km of range. Those
// two pull against each other, because a car driven fast empties its tank
// sooner, and that tension is the whole mechanic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  consumptionAt, cruiseKmh, rangeKm, performancePoints, applyMods, loadCars, dominated,
  BASELINE, REFERENCE_KMH,
} from '../scripts/lib/cars.mjs';

const golf = { name: 'test hatch', tankL: 50, wltpL100: 4.5, topKmh: 216, kerbKg: 1320 };
const rs = { name: 'test wagon', tankL: 73, wltpL100: 11.5, topKmh: 250, kerbKg: 2075 };

test('fuel consumption rises with speed', () => {
  assert.ok(consumptionAt(golf, 200) > consumptionAt(golf, 130));
  assert.ok(consumptionAt(golf, 130) > golf.wltpL100, 'even 130 costs more than the lab figure');
});

test('range is tank divided by what the car actually drinks at that speed', () => {
  const speed = 180;
  assert.equal(
    Math.round(rangeKm(golf, speed)),
    Math.round((golf.tankL / consumptionAt(golf, speed)) * 100),
  );
});

test('driving faster shortens range', () => {
  assert.ok(rangeKm(golf, 220) < rangeKm(golf, 150));
});

test('cruise speed is well under the brochure number and caps out', () => {
  assert.ok(cruiseKmh(golf) < golf.topKmh);
  assert.ok(cruiseKmh({ ...golf, topKmh: 340 }) <= 240, 'nobody holds 340 for an hour');
});

test('performance points are minutes saved over the baseline car', () => {
  assert.equal(performancePoints(BASELINE), 0);
  assert.ok(performancePoints(golf) > 0);
});

test('a diesel wagon beats a supercar over a cannonball', () => {
  // The real-world folk wisdom, and it should fall out of the measured
  // weights rather than being asserted: range is worth more than speed.
  const supercar = { name: 'test supercar', tankL: 80, wltpL100: 13.7, topKmh: 325, kerbKg: 1422 };
  const wagon = { name: 'test diesel', tankL: 70, wltpL100: 5.4, topKmh: 250, kerbKg: 1710 };
  assert.ok(performancePoints(wagon) > performancePoints(supercar));
});

test('an auxiliary tank buys range and costs weight', () => {
  const modded = applyMods(golf, ['aux-tank']);
  assert.ok(modded.tankL > golf.tankL);
  assert.ok(modded.kerbKg > golf.kerbKg);
  assert.ok(rangeKm(modded, 180) > rangeKm(golf, 180));
});

test('a tune buys speed and costs range', () => {
  const modded = applyMods(rs, ['tune']);
  assert.ok(cruiseKmh(modded) > cruiseKmh(rs));
  assert.ok(rangeKm(modded, 180) < rangeKm(rs, 180));
});

test('mods are order-independent and do not mutate the car', () => {
  const before = JSON.stringify(golf);
  const a = applyMods(golf, ['aux-tank', 'tune']);
  const b = applyMods(golf, ['tune', 'aux-tank']);
  assert.equal(JSON.stringify(golf), before, 'the base car is untouched');
  assert.equal(a.tankL, b.tankL);
  assert.equal(cruiseKmh(a), cruiseKmh(b));
});

test('an unknown mod is refused rather than silently ignored', () => {
  assert.throws(() => applyMods(golf, ['nitrous']), /nitrous/);
});

test('the shipped table is complete and every drivable car works', () => {
  const cars = loadCars('data/cars.json', { drivable: true });
  assert.ok(cars.length >= 15, 'enough cars to make a class limit mean something');
  for (const c of cars) {
    for (const field of ['id', 'name', 'year', 'tankL', 'wltpL100', 'topKmh', 'kerbKg']) {
      assert.ok(c[field] !== undefined, `${c.id ?? c.name} is missing ${field}`);
    }
    // No pace floor: a 1978 ambulance and a one-ton dually are meant to be
    // slow, and they score negative points for it — the baseline is a scoring
    // origin, not a minimum. What every car must do is cover real distance at
    // whatever pace it can ACTUALLY hold, not an arbitrary shared number.
    const pace = Math.min(150, cruiseKmh(c));
    assert.ok(rangeKm(c, pace) > 200, `${c.name} cannot cover 200 km at its own cruise pace (${pace} km/h)`);
    assert.ok(cruiseKmh(c) > 100, `${c.name} is too slow to race at all`);
  }
});

test('a car still waiting on a model is left out rather than returning NaN', () => {
  const all = loadCars();
  const drivable = loadCars('data/cars.json', { drivable: true });
  const pending = all.filter((c) => c.status);
  assert.ok(pending.length > 0, 'the electric car is in the table but not yet priceable');
  assert.equal(drivable.length, all.length - pending.length);
  for (const c of pending) assert.throws(() => performancePoints(c), new RegExp(c.status));
});

test('the table spans enough range for a class limit to mean something', () => {
  const pp = loadCars('data/cars.json', { drivable: true }).map(performancePoints);
  assert.ok(Math.max(...pp) - Math.min(...pp) >= 100,
    `the whole table spans ${Math.max(...pp) - Math.min(...pp)} points`);
});

test('range is compared at one pace, so a fast car is not charged twice', () => {
  const slow = { name: 'slow', tankL: 60, wltpL100: 6.0, topKmh: 180, kerbKg: 1500 };
  const fast = { ...slow, name: 'fast', topKmh: 300 };
  // Same tank, same engine, different gearing: the fast one must score higher.
  assert.ok(performancePoints(fast) > performancePoints(slow));
  assert.equal(rangeKm(fast, REFERENCE_KMH), rangeKm(slow, REFERENCE_KMH));
});
