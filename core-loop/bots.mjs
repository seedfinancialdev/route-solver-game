// Trivial policy functions proving the engine is bot-drivable: a function
// can stand in for a human's live choice at an interrupt. Not "smart" --
// the only claim under test is that driveRoute's chooseFn can be automated.

export function alwaysPushPolicy(interrupt) {
  return interrupt.choices.includes('push') ? 'push' : interrupt.choices[0];
}

export function alwaysFirstChoicePolicy(interrupt) {
  return interrupt.choices[0];
}
