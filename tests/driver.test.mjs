import test from 'node:test';
import assert from 'node:assert/strict';
import { driveRoute } from '../core-loop/driver.mjs';
import { widgetModule } from '../core-loop/modules/widget.mjs';
import { alwaysPushPolicy } from '../core-loop/bots.mjs';

test('driveRoute resolves every interrupt across a whole route using a bot policy', async () => {
  const route = [{ ticks: 12 }];
  const result = await driveRoute(route, [widgetModule], alwaysPushPolicy);
  // threshold 5: interrupts at tick 5 and tick 10 within the 12-tick leg,
  // then 2 more ticks with no interrupt -- 2 resolutions, pushed twice.
  assert.equal(result.log.length, 2);
  assert.deepEqual(result.finalStates.get('widget'), { count: 2, pushed: 2 });
});

test('driveRoute logs each choice with its exact leg and tick position', async () => {
  const route = [{ ticks: 12 }];
  const result = await driveRoute(route, [widgetModule], alwaysPushPolicy);
  assert.deepEqual(result.log, [
    { legIndex: 0, ticksIntoLeg: 5, module: 'widget', choice: 'push' },
    { legIndex: 0, ticksIntoLeg: 10, module: 'widget', choice: 'push' },
  ]);
});

test('driveRoute accepts an async chooseFn -- the same driver serves a live prompt or a bot', async () => {
  const route = [{ ticks: 5 }];
  const result = await driveRoute(route, [widgetModule], async (interrupt) => {
    await new Promise((resolve) => setTimeout(resolve, 0)); // simulate a real await, e.g. a prompt
    return interrupt.choices[0];
  });
  assert.equal(result.log.length, 1);
  assert.equal(result.log[0].choice, 'reset');
});

test('driveRoute carries module state across a leg boundary', async () => {
  // 3+3=6 ticks total, threshold 5 -- the interrupt lands mid-second-leg.
  const route = [{ ticks: 3 }, { ticks: 3 }];
  const result = await driveRoute(route, [widgetModule], alwaysPushPolicy);
  assert.equal(result.log.length, 1);
  assert.equal(result.log[0].legIndex, 1);
  assert.equal(result.log[0].ticksIntoLeg, 2); // the 5th total tick is the 2nd tick of leg 1
});
