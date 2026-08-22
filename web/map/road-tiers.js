/**
 * Which drawing bucket each stretch of road belongs in, by PACE.
 *
 * The pace tier IS the player's evidence (docs/CARTOGRAPHY.md, "Load-bearing"):
 * a road's drawn weight is how they guess how fast it runs. `scripts/05-bundle.mjs`
 * is the authority on the ordering — a stretch is tier 2 at or above FAST_KMH —
 * so tier 2 is the FASTEST and must draw heaviest. Inverting this deletes the
 * game's core signal.
 *
 * A road is split along its length rather than classified whole: a single
 * city-to-city road is routinely fast in the middle and slow at both ends, and
 * drawing it as one uniform stretch throws that away.
 *
 * These buckets are named for pace, not for road class. They were once called
 * motorways / trunks / primaries, which meant a slow mountain stretch of a real
 * motorway bucketed as a "primary" — a road-class word asserting a speed. Pace
 * is measured (OSRM step time over step distance); class is an OSM tag. They
 * are different variables, and the gap between them is what the player learns
 * to read, so the class words stay reserved for real class data.
 */
import { splitPaceRuns } from '../engine.js';

export const TIER_FAST = 2;
export const TIER_ORDINARY = 1;
export const TIER_SLOW = 0;

/**
 * Every road in the graph, split into single-pace runs and bucketed by tier.
 *
 * `buildGraph` pushes the same shape into both endpoints' adjacency lists, so
 * walking `adj` naively draws every road twice; `edge.to < i` keeps one copy.
 *
 * @param {Array<Array<{to: number, shape: Array<[number, number]>, pace: number[]}>>} adj
 * @returns {{fast: Array<Array<[number, number]>>, ordinary: Array<Array<[number, number]>>, slow: Array<Array<[number, number]>>}}
 */
export function bucketRoadRuns(adj) {
  const fast = [];
  const ordinary = [];
  const slow = [];
  if (!adj) return { fast, ordinary, slow };

  for (let i = 0; i < adj.length; i++) {
    for (const edge of adj[i]) {
      if (edge.to < i) continue;
      if (!edge.shape || edge.shape.length < 2) continue;
      for (const run of splitPaceRuns(edge.shape, edge.pace)) {
        if (run.tier === TIER_FAST) fast.push(run.pts);
        else if (run.tier === TIER_ORDINARY) ordinary.push(run.pts);
        else if (run.tier === TIER_SLOW) slow.push(run.pts);
        else {
          throw new Error(
            `bucketRoadRuns: unexpected pace tier ${run.tier} — expected `
            + `${TIER_FAST} (fast), ${TIER_ORDINARY} (ordinary), or ${TIER_SLOW} (slow). `
            + 'Malformed tier data must not fall through and draw as the slowest.',
          );
        }
      }
    }
  }
  return { fast, ordinary, slow };
}
