import test from 'node:test';
import assert from 'node:assert/strict';
import { stepOnce, runLeg, resolveInterrupt } from '../core-loop/step-engine.mjs';

/** Interrupts on exactly its 3rd advance() call. Test-only, not a real module. */
const testModule = {
  name: 'counter',
  init: () => ({ n: 0 }),
  advance(state) {
    const n = state.n + 1;
    if (n === 3) return { state: { n }, interrupt: { choices: ['a', 'b'] } };
    return { state: { n }, interrupt: null };
  },
  resolve: (state, choice) => ({ n: 0, lastChoice: choice }),
};

test('stepOnce advances a module and reports no interrupt below threshold', () => {
  const states = new Map([['counter', testModule.init()]]);
  const result = stepOnce(states, [testModule]);
  assert.equal(result.interrupt, null);
  assert.deepEqual(result.moduleStates.get('counter'), { n: 1 });
});

test('stepOnce reports an interrupt, tagged with the module name, on the exact tick it fires', () => {
  let states = new Map([['counter', testModule.init()]]);
  states = stepOnce(states, [testModule]).moduleStates; // tick 1
  const second = stepOnce(states, [testModule]);         // tick 2
  states = second.moduleStates;
  assert.equal(second.interrupt, null);
  const third = stepOnce(states, [testModule]);           // tick 3
  assert.deepEqual(third.interrupt, { module: 'counter', choices: ['a', 'b'] });
});

test('runLeg stops exactly at the tick an interrupt fires, not the whole leg', () => {
  const states = new Map([['counter', testModule.init()]]);
  const result = runLeg({ ticks: 10 }, states, [testModule]);
  assert.equal(result.ticksConsumed, 3);
  assert.deepEqual(result.interrupt, { module: 'counter', choices: ['a', 'b'] });
  assert.deepEqual(result.moduleStates.get('counter'), { n: 3 });
});

test('runLeg completes cleanly, consuming every tick, when no interrupt fires', () => {
  const states = new Map([['counter', testModule.init()]]);
  const result = runLeg({ ticks: 2 }, states, [testModule]);
  assert.equal(result.ticksConsumed, 2);
  assert.equal(result.interrupt, null);
});

test('runLeg on a zero-tick leg consumes nothing and never crashes', () => {
  const states = new Map([['counter', testModule.init()]]);
  const result = runLeg({ ticks: 0 }, states, [testModule]);
  assert.equal(result.ticksConsumed, 0);
  assert.equal(result.interrupt, null);
});

test('the step function has no built-in knowledge of the module it advances', () => {
  // A second, structurally different test module -- same engine, zero changes.
  const flatModule = {
    name: 'flat',
    init: () => ({ total: 0 }),
    advance: (state) => ({ state: { total: state.total + 10 }, interrupt: null }),
    resolve: (state) => state,
  };
  const states = new Map([['flat', flatModule.init()]]);
  const result = runLeg({ ticks: 3 }, states, [flatModule]);
  assert.deepEqual(result.moduleStates.get('flat'), { total: 30 });
});

test('resolveInterrupt applies the module\'s own resolve() for the given choice', () => {
  const states = new Map([['counter', testModule.init()]]);
  const leg = runLeg({ ticks: 10 }, states, [testModule]);
  const resolved = resolveInterrupt(leg.moduleStates, [testModule], leg.interrupt, 'a');
  assert.deepEqual(resolved.get('counter'), { n: 0, lastChoice: 'a' });
});

test('resolveInterrupt throws on an interrupt naming an unregistered module', () => {
  const states = new Map([['counter', testModule.init()]]);
  assert.throws(
    () => resolveInterrupt(states, [testModule], { module: 'ghost', choices: [] }, 'a'),
    /no registered module named "ghost"/,
  );
});
