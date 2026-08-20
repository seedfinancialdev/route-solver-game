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
 * registration order, or null if none of them raised one this tick.
 *
 * When two or more modules raise an interrupt on the same tick, only the
 * first (by registration order) is reported here -- every other module
 * still advances normally on this tick, but its interrupt for this tick is
 * discarded outright, not queued and not deferred to a later tick. A module
 * whose interrupt condition is edge-triggered (e.g. an exact-equality
 * threshold such as `n === 3`) can therefore miss firing permanently if its
 * one qualifying tick collides with an earlier-registered module's
 * interrupt: its state keeps advancing past the threshold, so the
 * condition never becomes true again for the rest of the leg. */
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
