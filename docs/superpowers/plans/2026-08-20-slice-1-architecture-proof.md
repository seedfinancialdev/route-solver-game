# Slice 1: Architecture Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the core-loop step-function architecture — module registration, tick-by-tick interrupt/pause/resume, bot-drivability, deterministic replay — using a single, entirely invented, throwaway module with no game-design meaning.

**Architecture:** A pure tick-advancement engine (`stepOnce`, `runLeg`, `resolveInterrupt`) with zero knowledge of any specific module, driven by an async orchestration layer (`driveRoute`, `replayRoute`) that calls it repeatedly until a route completes. A throwaway `widget` module and a trivial bot policy exercise the whole thing end to end; a terminal tool exercises it with a human. Nothing here touches game content, UI, or any existing file in the repo.

**Tech Stack:** Node (ES modules, `"type": "module"`), `node:test` + `node:assert/strict`, `node:readline/promises`. No new dependencies.

## Global Constraints

- **No new npm dependencies.**
- **ES modules only.**
- **`core-loop/step-engine.mjs`, `core-loop/modules/widget.mjs`, `core-loop/driver.mjs`, and `core-loop/bots.mjs` stay dependency-free and side-effect-free** — no file I/O, no `console.log`, no `process.exit`. Only `core-loop/play.mjs` does I/O, per this project's existing convention for pure-library-vs-I/O-doing-CLI (`scripts/lib/*.mjs` vs. the CLIs that consume them).
- **Nothing under `core-loop/` imports from `scripts/`, `scripts/lib/`, `play/`, or `web/`.** This is the explicit greenfield requirement from `docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md`, "Build order: greenfield, not retrofit" — slice 1 exists specifically to prove the architecture with zero contact with the existing codebase.
- **The widget module is explicitly, permanently throwaway.** Its own file comment must say so. Nothing later builds real game logic on top of it — see "Slice 2" in the spec, which designs a real first module fresh.
- Tests use Node's built-in `node --test`, added to the existing `tests/` directory — already globbed by `package.json`'s `"test": "node --test 'tests/**/*.test.mjs'"` script, so no script change needed for test discovery.

---

## File Structure

**Create:**

| file | responsibility |
| --- | --- |
| `core-loop/step-engine.mjs` | pure: tick-by-tick advancement, interrupt detection, interrupt resolution |
| `core-loop/modules/widget.mjs` | pure: the throwaway synthetic module |
| `core-loop/driver.mjs` | pure-ish (async, no I/O): drives a whole route to completion, and replays a recorded one |
| `core-loop/bots.mjs` | pure: trivial policy functions standing in for a human at an interrupt |
| `core-loop/play.mjs` | I/O: terminal proof tool, human- or bot-driven |
| `tests/step-engine.test.mjs` | tests for `stepOnce`, `runLeg`, `resolveInterrupt` |
| `tests/widget-module.test.mjs` | tests for the widget module in isolation, plus its integration with the real engine |
| `tests/driver.test.mjs` | tests for `driveRoute` |
| `tests/replay.test.mjs` | tests for `replayRoute` — the core determinism claim |

**Modify:**

- `package.json` — add a `"core-loop:play"` script.

---

### Task 1: Pure tick-advancement engine

**Files:**
- Create: `core-loop/step-engine.mjs`
- Test: `tests/step-engine.test.mjs`

**Interfaces:**
- Produces:
  - A **module** is `{ name: string, init(): state, advance(state): { state, interrupt: null | InterruptBody }, resolve(state, choice: string): state }`, where `InterruptBody` is `{ reason?: string, choices: string[] }`.
  - `stepOnce(moduleStates: Map<string, state>, modules: Module[]): { moduleStates: Map, interrupt: null | { module: string, ...InterruptBody } }` — advances every registered module by exactly one tick; returns the first interrupt raised, by registration order, or `null`.
  - `runLeg(leg: { ticks: number }, moduleStates: Map, modules: Module[]): { moduleStates: Map, ticksConsumed: number, interrupt: null | { module, reason?, choices } }` — advances tick by tick until either `leg.ticks` ticks have been consumed or an interrupt fires; stops immediately on the tick an interrupt fires.
  - `resolveInterrupt(moduleStates: Map, modules: Module[], interrupt: { module: string, ... }, choice: string): Map` — applies the named module's own `resolve(state, choice)`, returns updated `moduleStates`. Throws if `interrupt.module` names a module not in `modules`.

- [ ] **Step 1: Write the failing tests**

Create `tests/step-engine.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/step-engine.test.mjs`
Expected: FAIL — cannot find module `../core-loop/step-engine.mjs`.

- [ ] **Step 3: Write the implementation**

Create `core-loop/step-engine.mjs`:

```js
// The core-loop step engine: a pure, deterministic simulator over a
// sequence of "legs," advanced by zero or more registered modules. No
// module-specific knowledge lives here -- see
// docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md,
// "Architecture: one step function, two drivers". Pure and
// side-effect-free by design: no I/O, no console, no process -- the same
// convention scripts/lib/*.mjs already follows in this repo.
//
// A module is: { name, init(): state, advance(state): {state, interrupt},
// resolve(state, choice): state }. interrupt, when not null, is
// { reason?, choices: string[] }.
//
// A leg is the smallest unit of route structure: { ticks: number }. "ticks"
// is an abstract unit of simulated time -- this slice never attaches
// real-world meaning to it (see "Build order: greenfield, not retrofit").

/** Advance every module by one tick. Returns the first interrupt raised, by
 * registration order, or null if none of them raised one this tick. */
export function stepOnce(moduleStates, modules) {
  const nextStates = new Map(moduleStates);
  let interrupt = null;
  for (const mod of modules) {
    const state = moduleStates.get(mod.name);
    const result = mod.advance(state);
    nextStates.set(mod.name, result.state);
    if (!interrupt && result.interrupt) interrupt = { module: mod.name, ...result.interrupt };
  }
  return { moduleStates: nextStates, interrupt };
}

/** Advance through a leg (leg.ticks ticks), one tick at a time, stopping at
 * the first interrupt any module raises. ticksConsumed is leg.ticks when
 * nothing interrupted, or the exact tick the interrupt fired on. */
export function runLeg(leg, moduleStates, modules) {
  let states = moduleStates;
  for (let t = 0; t < leg.ticks; t++) {
    const result = stepOnce(states, modules);
    states = result.moduleStates;
    if (result.interrupt) return { moduleStates: states, ticksConsumed: t + 1, interrupt: result.interrupt };
  }
  return { moduleStates: states, ticksConsumed: leg.ticks, interrupt: null };
}

/** Apply a module's response to its own interrupt, clearing whatever raised
 * it. Only updates state -- the caller resumes by re-invoking runLeg with
 * the leg's remaining ticks; this function doesn't advance time itself. */
export function resolveInterrupt(moduleStates, modules, interrupt, choice) {
  const mod = modules.find((m) => m.name === interrupt.module);
  if (!mod) throw new Error(`resolveInterrupt: no registered module named "${interrupt.module}"`);
  const nextState = mod.resolve(moduleStates.get(mod.name), choice);
  const nextStates = new Map(moduleStates);
  nextStates.set(mod.name, nextState);
  return nextStates;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/step-engine.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add core-loop/step-engine.mjs tests/step-engine.test.mjs
git commit -m "feat(core-loop): add the pure tick-advancement step engine"
```

---

### Task 2: The widget module

**Files:**
- Create: `core-loop/modules/widget.mjs`
- Test: `tests/widget-module.test.mjs`

**Interfaces:**
- Consumes: `runLeg`, `resolveInterrupt` from `core-loop/step-engine.mjs` (Task 1) — for this task's integration test only.
- Produces: `widgetModule: Module` (matching Task 1's `Module` shape) and `WIDGET_THRESHOLD: number` (currently `5`).

- [ ] **Step 1: Write the failing tests**

Create `tests/widget-module.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/widget-module.test.mjs`
Expected: FAIL — cannot find module `../core-loop/modules/widget.mjs`.

- [ ] **Step 3: Write the implementation**

Create `core-loop/modules/widget.mjs`:

```js
// A throwaway, deliberately meaningless module. Its only job is proving the
// step-engine architecture works -- registration, interrupts, pause/resume,
// bot-drivability, replay -- with zero game-design content attached. See
// docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md,
// "Build order: greenfield, not retrofit". Delete this once slice 1 is
// proven; do not build real game logic on top of it.

export const WIDGET_THRESHOLD = 5;

export const widgetModule = {
  name: 'widget',

  init() {
    return { count: 0, pushed: 0 };
  },

  advance(state) {
    const count = state.count + 1;
    if (count >= WIDGET_THRESHOLD) {
      return {
        state: { ...state, count },
        interrupt: { reason: 'widget hit its threshold', choices: ['reset', 'push'] },
      };
    }
    return { state: { ...state, count }, interrupt: null };
  },

  resolve(state, choice) {
    if (choice === 'reset') return { count: 0, pushed: state.pushed };
    if (choice === 'push') return { count: 0, pushed: state.pushed + 1 };
    throw new Error(`widget: unknown choice "${choice}"`);
  },
};
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/widget-module.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add core-loop/modules/widget.mjs tests/widget-module.test.mjs
git commit -m "feat(core-loop): add the throwaway widget module"
```

---

### Task 3: The route driver

**Files:**
- Create: `core-loop/bots.mjs`
- Create: `core-loop/driver.mjs`
- Test: `tests/driver.test.mjs`

**Interfaces:**
- Consumes: `runLeg`, `resolveInterrupt` from `core-loop/step-engine.mjs` (Task 1); `widgetModule` from `core-loop/modules/widget.mjs` (Task 2) — test only.
- Produces:
  - `alwaysPushPolicy(interrupt: {choices: string[]}): string` and `alwaysFirstChoicePolicy(interrupt): string` from `core-loop/bots.mjs`.
  - `driveRoute(route: {ticks:number}[], modules: Module[], chooseFn: (interrupt, {legIndex, ticksIntoLeg}) => string | Promise<string>): Promise<{ finalStates: Map, log: Array<{legIndex, ticksIntoLeg, module, choice}> }>` from `core-loop/driver.mjs`.

- [ ] **Step 1: Write the failing tests**

Create `tests/driver.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/driver.test.mjs`
Expected: FAIL — cannot find module `../core-loop/driver.mjs` (and `../core-loop/bots.mjs`).

- [ ] **Step 3: Write the implementation**

Create `core-loop/bots.mjs`:

```js
// Trivial policy functions proving the engine is bot-drivable: a function
// can stand in for a human's live choice at an interrupt. Not "smart" --
// the only claim under test is that driveRoute's chooseFn can be automated.

export function alwaysPushPolicy(interrupt) {
  return interrupt.choices.includes('push') ? 'push' : interrupt.choices[0];
}

export function alwaysFirstChoicePolicy(interrupt) {
  return interrupt.choices[0];
}
```

Create `core-loop/driver.mjs`:

```js
// The orchestration layer sitting on top of the pure step engine -- "one
// step function, two drivers" (see the spec). This slice builds the
// repeat-until-done driver used by solo modes; the wall-clock,
// server-authoritative driver for multiplayer is out of scope here (see
// docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md,
// "Architecture: one step function, two drivers").

import { runLeg, resolveInterrupt } from './step-engine.mjs';

/**
 * Drive an entire route (array of legs) to completion, calling `chooseFn`
 * whenever an interrupt fires. chooseFn may be sync or async -- it's
 * awaited either way, so the same driver serves a live human prompt
 * (async) and an automated bot policy (sync) without changing anything
 * here. Every choice is recorded as {legIndex, ticksIntoLeg, module,
 * choice} so the whole run can be reproduced later from just this log.
 */
export async function driveRoute(route, modules, chooseFn) {
  let states = new Map(modules.map((m) => [m.name, m.init()]));
  const log = [];
  for (let legIndex = 0; legIndex < route.length; legIndex++) {
    let remaining = route[legIndex];
    let ticksIntoLeg = 0;
    for (;;) {
      const result = runLeg(remaining, states, modules);
      states = result.moduleStates;
      ticksIntoLeg += result.ticksConsumed;
      if (!result.interrupt) break;
      const choice = await chooseFn(result.interrupt, { legIndex, ticksIntoLeg });
      log.push({ legIndex, ticksIntoLeg, module: result.interrupt.module, choice });
      states = resolveInterrupt(states, modules, result.interrupt, choice);
      remaining = { ticks: route[legIndex].ticks - ticksIntoLeg };
    }
  }
  return { finalStates: states, log };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/driver.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add core-loop/bots.mjs core-loop/driver.mjs tests/driver.test.mjs
git commit -m "feat(core-loop): add the route driver and bot policies"
```

---

### Task 4: Deterministic replay

**Files:**
- Modify: `core-loop/driver.mjs` (add `replayRoute`)
- Test: `tests/replay.test.mjs`

**Interfaces:**
- Consumes: `driveRoute` from `core-loop/driver.mjs` (Task 3); `widgetModule` from `core-loop/modules/widget.mjs` (Task 2); `alwaysPushPolicy` from `core-loop/bots.mjs` (Task 3).
- Produces: `replayRoute(route: {ticks:number}[], modules: Module[], log: Array<{choice}>): Promise<{finalStates, log}>` — same return shape as `driveRoute`.

- [ ] **Step 1: Write the failing tests**

Create `tests/replay.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/replay.test.mjs`
Expected: FAIL — `replayRoute is not a function` (not yet exported from `core-loop/driver.mjs`).

- [ ] **Step 3: Write the implementation**

Add to `core-loop/driver.mjs` (after `driveRoute`):

```js
/**
 * Replay a previously recorded run: same route, same modules, but choices
 * come from the log instead of a live chooseFn. If the engine is
 * genuinely deterministic, this reproduces byte-identical finalStates and
 * an identical log to the original run that produced it.
 */
export async function replayRoute(route, modules, log) {
  let i = 0;
  return driveRoute(route, modules, () => {
    if (i >= log.length) throw new Error('replayRoute: log ran out of recorded choices');
    return log[i++].choice;
  });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/replay.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS, all tests across every file (existing project tests plus this slice's 4 new files).

- [ ] **Step 6: Commit**

```bash
git add core-loop/driver.mjs tests/replay.test.mjs
git commit -m "feat(core-loop): add deterministic replay"
```

---

### Task 5: Terminal proof tool

**Files:**
- Create: `core-loop/play.mjs`
- Modify: `package.json` (add `core-loop:play` script)

**Interfaces:**
- Consumes: `driveRoute` from `core-loop/driver.mjs`; `widgetModule` from `core-loop/modules/widget.mjs`; `alwaysPushPolicy` from `core-loop/bots.mjs`.

This task is a thin, I/O-doing consumer of already-tested logic (Tasks 1–4), the same relationship `scripts/perf-profile.mjs` has to `scripts/lib/asset-scan.mjs` elsewhere in this repo — verified by running it and reading its output, not by unit tests.

- [ ] **Step 1: Write the tool**

Create `core-loop/play.mjs`:

```js
#!/usr/bin/env node
// Terminal proof tool for slice 1: drives a fixed, invented route through
// the step engine using the widget module, prompting a human for each
// interrupt. Not a game -- a manual check that the architecture behaves
// the way the automated tests already prove it does. See
// docs/superpowers/specs/2026-08-20-core-gameplay-loop-design.md.
//
// Run:               npm run core-loop:play
// Run bot-driven:     npm run core-loop:play -- --bot

import { createInterface } from 'node:readline/promises';
import { driveRoute } from './driver.mjs';
import { widgetModule } from './modules/widget.mjs';
import { alwaysPushPolicy } from './bots.mjs';

const ROUTE = [{ ticks: 8 }, { ticks: 12 }, { ticks: 6 }]; // invented, meaningless -- not a real map

const useBot = process.argv.includes('--bot');
const rl = useBot ? null : createInterface({ input: process.stdin, output: process.stdout });

async function humanChoice(interrupt, { legIndex, ticksIntoLeg }) {
  console.log(`\n[leg ${legIndex}, tick ${ticksIntoLeg}] ${interrupt.reason} -- choices: ${interrupt.choices.join(', ')}`);
  let answer;
  do {
    answer = (await rl.question('> ')).trim();
  } while (!interrupt.choices.includes(answer));
  return answer;
}

async function botChoice(interrupt, { legIndex, ticksIntoLeg }) {
  const choice = alwaysPushPolicy(interrupt);
  console.log(`\n[leg ${legIndex}, tick ${ticksIntoLeg}] ${interrupt.reason} -- bot picks: ${choice}`);
  return choice;
}

const result = await driveRoute(ROUTE, [widgetModule], useBot ? botChoice : humanChoice);
if (rl) rl.close();

console.log(`\nRoute complete. ${result.log.length} interrupt(s) resolved.`);
console.log('Final widget state:', result.finalStates.get('widget'));
console.log('Log:', JSON.stringify(result.log, null, 2));
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"core-loop:play": "node core-loop/play.mjs"
```

- [ ] **Step 3: Verify the bot-driven path**

Run: `npm run core-loop:play -- --bot`

Expected: runs to completion without error. Route is `[8, 12, 6]` ticks (26 total), threshold 5. State carries across leg boundaries — it does not reset when a leg ends — so the interrupt fires 5 times total, printing `bot picks: push` each time, at (in the order printed): `[leg 0, tick 5]`, `[leg 1, tick 2]`, `[leg 1, tick 7]`, `[leg 1, tick 12]`, `[leg 2, tick 5]`. Final summary: `Final widget state: { count: 1, pushed: 5 }` (26 ticks, 5 resolutions consuming 5 ticks each = 25, 1 tick left over unresolved) and a `log` array of exactly those 5 entries.

- [ ] **Step 4: Verify the human-driven path**

Run: `npm run core-loop:play`

At each prompt, first type something not in the offered choices (e.g. `xyz`) and confirm it re-prompts rather than crashing or accepting it. Then type a valid choice (`reset` or `push`) and confirm it proceeds. Repeat until the route completes; confirm the final summary prints and the process exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add core-loop/play.mjs package.json
git commit -m "feat(core-loop): add the terminal proof tool"
```

---

## Verification

After Task 5, run everything:

```bash
npm test                          # expect: all tests pass, including this slice's 4 new files
npm run core-loop:play -- --bot   # expect: completes cleanly, 5 resolutions, final state as computed above
```

This slice's job is narrow: prove registration, interrupt/pause/resume, bot-drivability, and deterministic replay all work, with nothing from the existing codebase involved. It does not produce a game, a UI, or real game content — that's Slice 2 onward (GitHub issue #5), which designs a real first module fresh once this architecture is proven.
