import test from 'node:test';
import assert from 'node:assert/strict';
import { widgetModule, WIDGET_THRESHOLD } from '../core-loop/modules/widget.mjs';
import { runLeg, resolveInterrupt } from '../core-loop/step-engine.mjs';

test('widget interrupts exactly on its threshold tick, not before', () => {
  let state = widgetModule.init();
  for (let i = 0; i < WIDGET_THRESHOLD - 1; i++) {
    const result = widgetModule.advance(state);
    assert.equal(result.interrupt, null);
    state = result.state;
  }
  const final = widgetModule.advance(state);
  assert.deepEqual(final.interrupt, { reason: 'widget hit its threshold', choices: ['reset', 'push'] });
});

test('widget "reset" clears the count without incrementing pushed', () => {
  const state = { count: WIDGET_THRESHOLD, pushed: 2 };
  assert.deepEqual(widgetModule.resolve(state, 'reset'), { count: 0, pushed: 2 });
});

test('widget "push" clears the count and increments pushed', () => {
  const state = { count: WIDGET_THRESHOLD, pushed: 2 };
  assert.deepEqual(widgetModule.resolve(state, 'push'), { count: 0, pushed: 3 });
});

test('widget rejects an unrecognized choice', () => {
  assert.throws(() => widgetModule.resolve({ count: 5, pushed: 0 }, 'nope'), /unknown choice "nope"/);
});

test('the real step engine correctly pauses and resumes against the widget module, not just a fake test module', () => {
  const states = new Map([['widget', widgetModule.init()]]);
  const leg = runLeg({ ticks: 10 }, states, [widgetModule]);
  assert.equal(leg.ticksConsumed, WIDGET_THRESHOLD);
  assert.deepEqual(leg.interrupt, {
    module: 'widget', reason: 'widget hit its threshold', choices: ['reset', 'push'],
  });
  const resolved = resolveInterrupt(leg.moduleStates, [widgetModule], leg.interrupt, 'push');
  assert.deepEqual(resolved.get('widget'), { count: 0, pushed: 1 });
});
