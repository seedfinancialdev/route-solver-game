import test from 'node:test';
import assert from 'node:assert/strict';
import { driveRoute, replayRoute } from '../core-loop/driver.mjs';
import { widgetModule } from '../core-loop/modules/widget.mjs';
import { alwaysPushPolicy } from '../core-loop/bots.mjs';

test('replaying a recorded run reproduces an identical result -- the core determinism claim', async () => {
  const route = [{ ticks: 12 }, { ticks: 7 }];
  const original = await driveRoute(route, [widgetModule], alwaysPushPolicy);
  const replayed = await replayRoute(route, [widgetModule], original.log);
  assert.deepEqual(replayed.finalStates, original.finalStates);
  assert.deepEqual(replayed.log, original.log);
});

test('replay reproduces the run exactly regardless of the original policy, because it only reads the log, never calls a live policy again', async () => {
  const route = [{ ticks: 20 }];
  const original = await driveRoute(route, [widgetModule], (interrupt) => interrupt.choices[0]); // 'reset' every time
  const replayed = await replayRoute(route, [widgetModule], original.log);
  assert.deepEqual(replayed.finalStates, original.finalStates);
});

test('replay throws cleanly if the log runs out before the route does', async () => {
  const route = [{ ticks: 12 }];
  const original = await driveRoute(route, [widgetModule], alwaysPushPolicy);
  const truncatedLog = original.log.slice(0, 1); // drop the second recorded choice
  await assert.rejects(
    () => replayRoute(route, [widgetModule], truncatedLog),
    /log ran out of recorded choices/,
  );
});
