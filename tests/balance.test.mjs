import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readCriteria, checkShippedSet, sweepRow, findCliff, formatSpecTable,
} from '../scripts/lib/balance.mjs';

const CRITERIA = {
  MIN_SHORTEST_PENALTY: 1.12,
  MAX_WORST_RATIO: 1.45,
  MAX_STUCK_RATE: 0.15,
  MIN_HOURS: 12, MAX_HOURS: 40,
  MIN_HOPS: 7, MAX_HOPS: 16,
};

/** Passes everything: 20h optimal, shortest 1.2x that, budget 1.11x. */
const good = { a: 0, b: 1, optimalMin: 1200, shortestMin: 1440, budgetMin: 1332, hops: 10 };
const pack = (puzzles) => ({ criteria: CRITERIA, puzzles });

test('readCriteria throws rather than defaulting when the block is missing', () => {
  assert.throws(() => readCriteria({ puzzles: [] }), /criteria/);
});

test('readCriteria returns the block when present', () => {
  assert.equal(readCriteria(pack([])).MIN_SHORTEST_PENALTY, 1.12);
});

test('a sound puzzle set passes every check', () => {
  const out = checkShippedSet(pack([good]), 10);
  assert.equal(out.total, 1);
  assert.equal(out.shortestRoadWins.length, 0);
  assert.equal(out.trapFailures.length, 0);
  assert.equal(out.boundsFailures.length, 0);
  assert.deepEqual(out.badIndices, []);
});

test('a puzzle the shortest road wins outright is caught', () => {
  // shortest 1300 comes in under the 1332 budget
  const out = checkShippedSet(pack([{ ...good, shortestMin: 1300 }]), 10);
  assert.equal(out.shortestRoadWins.length, 1);
  assert.equal(out.shortestRoadWins[0].index, 0);
});

test('a puzzle below the trap ratio is caught', () => {
  // 1300/1200 = 1.083, under the 1.12 floor
  const out = checkShippedSet(pack([{ ...good, shortestMin: 1300 }]), 10);
  assert.equal(out.trapFailures.length, 1);
});

test('a puzzle outside the hours bound is caught', () => {
  const out = checkShippedSet(pack([
    { ...good, optimalMin: 600, shortestMin: 720, budgetMin: 666 },
  ]), 10);
  assert.equal(out.boundsFailures.length, 1);
  assert.match(out.boundsFailures[0].reason, /hours/);
});

test('a puzzle outside the hops bound is caught', () => {
  const out = checkShippedSet(pack([{ ...good, hops: 3 }]), 10);
  assert.equal(out.boundsFailures.length, 1);
  assert.match(out.boundsFailures[0].reason, /hops/);
});

test('an out-of-range city index is caught', () => {
  const out = checkShippedSet(pack([{ ...good, b: 99 }]), 10);
  assert.deepEqual(out.badIndices, [99]);
});

test('sweepRow counts a shortest-road win only at a generous multiplier', () => {
  const runs = [{ a: 0, b: 1, optMin: 1000, short: 1150, reader: [1050, 1200] }];
  assert.equal(sweepRow(runs, 1.20).shortWins, 1);
  assert.equal(sweepRow(runs, 1.10).shortWins, 0);
});

test('sweepRow counts reader wins over finished runs only', () => {
  const runs = [{ a: 0, b: 1, optMin: 1000, short: 1200, reader: [1050, Infinity] }];
  const row = sweepRow(runs, 1.10);
  assert.equal(row.readerWins, 1);
  assert.equal(row.readerWinRate, 1);
});

test('findCliff returns the lowest multiplier where the shortest road first wins', () => {
  const runs = [{ a: 0, b: 1, optMin: 1000, short: 1150, reader: [1050] }];
  assert.equal(findCliff(runs, [1.08, 1.10, 1.12, 1.15, 1.20]), 1.15);
});

test('findCliff returns null when the shortest road never wins', () => {
  const runs = [{ a: 0, b: 1, optMin: 1000, short: 2000, reader: [1050] }];
  assert.equal(findCliff(runs, [1.08, 1.10, 1.12]), null);
});

test('formatSpecTable emits a markdown table with a header row', () => {
  const table = formatSpecTable([
    sweepRow([{ a: 0, b: 1, optMin: 1000, short: 1200, reader: [1050] }], 1.11),
  ]);
  assert.match(table, /\| multiplier \|/);
  assert.match(table, /\| 1\.11 \|/);
});
