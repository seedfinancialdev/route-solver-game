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
