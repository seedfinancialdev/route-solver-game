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
