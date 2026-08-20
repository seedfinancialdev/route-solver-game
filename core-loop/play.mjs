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
