/**
 * Which drawing bucket each stretch of road belongs in.
 *
 * The pace tier IS the player's evidence (docs/CARTOGRAPHY.md, "Load-bearing"):
 * a road's drawn weight is how they guess how fast it runs. `scripts/05-bundle.mjs`
 * is the authority on the ordering — a stretch is tier 2 at or above FAST_KMH —
 * so tier 2 is the FASTEST and must draw heaviest. Inverting this deletes the
 * game's core signal.
 *
 * A road is split along its length rather than classified whole: a single
 * city-to-city road is routinely motorway in the middle and slow at both ends,
 * and drawing it as one class throws that away.
 */
import { splitPaceRuns } from '../engine.js';

export const TIER_MOTORWAY = 2;
export const TIER_TRUNK = 1;
export const TIER_PRIMARY = 0;

/**
 * Every road in the graph, split into single-pace runs and bucketed by tier.
 *
 * `buildGraph` pushes the same shape into both endpoints' adjacency lists, so
 * walking `adj` naively draws every road twice; `edge.to < i` keeps one copy.
 *
 * @param {Array<Array<{to: number, shape: Array<[number, number]>, pace: number[]}>>} adj
 * @returns {{motorways: Array<Array<[number, number]>>, trunks: Array<Array<[number, number]>>, primaries: Array<Array<[number, number]>>}}
 */
export function bucketRoadRuns(adj) {
  const motorways = [];
  const trunks = [];
  const primaries = [];
  if (!adj) return { motorways, trunks, primaries };

  for (let i = 0; i < adj.length; i++) {
    for (const edge of adj[i]) {
      if (edge.to < i) continue;
      if (!edge.shape || edge.shape.length < 2) continue;
      for (const run of splitPaceRuns(edge.shape, edge.pace)) {
        if (run.tier === TIER_MOTORWAY) motorways.push(run.pts);
        else if (run.tier === TIER_TRUNK) trunks.push(run.pts);
        else primaries.push(run.pts);
      }
    }
  }
  return { motorways, trunks, primaries };
}
