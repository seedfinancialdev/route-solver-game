// Pure asset-reachability analysis for the perf audit. No I/O — the caller
// reads files and hands in contents, same convention as scripts/lib/graph.mjs.

const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
const PATTERN = /[A-Za-z0-9_][A-Za-z0-9._/-]*\.(?:webp|json|png|css|js|html)/g;

/**
 * Asset basenames mentioned in one source file. Basename rather than full path,
 * because the client builds paths with relative prefixes and `?v=`
 * cache-busting template literals — see web/map/terrain-layer.js:50.
 */
export function referencesIn(text) {
  const found = new Set();
  for (const match of text.matchAll(PATTERN)) found.add(basename(match[0]));
  return found;
}

/**
 * Split assets into eager (transitively reachable from an entry point),
 * deferred (reached only through a reachable manifest) and orphan.
 *
 * Reachability rather than mention: web/map/'s modules reference each other but
 * nothing in the shipped game reaches them (web/index.html:174 loads only
 * app.js), and a mention-based check would wrongly call them live.
 *
 * Where two assets share a basename the walk reaches both. That is deliberate:
 * over-reporting an orphan is a worse failure than missing one.
 */
export function classify({ assets, sources, entryPoints, manifests }) {
  const byBasename = new Map();
  for (const a of assets) {
    const key = basename(a);
    if (!byBasename.has(key)) byBasename.set(key, []);
    byBasename.get(key).push(a);
  }

  const reached = new Set();
  const queue = entryPoints.filter((e) => assets.includes(e));
  queue.forEach((e) => reached.add(e));

  while (queue.length) {
    const current = queue.pop();
    const text = sources.get(current);
    if (text === undefined) continue; // a binary asset refers to nothing
    for (const ref of referencesIn(text)) {
      for (const target of byBasename.get(ref) ?? []) {
        if (reached.has(target)) continue;
        reached.add(target);
        queue.push(target);
      }
    }
  }

  const deferred = new Set();
  for (const m of manifests) {
    if (!reached.has(m.file)) continue;
    for (const p of m.provides) if (!reached.has(p)) deferred.add(p);
  }

  const sort = (xs) => [...xs].sort();
  return {
    eager: sort(reached),
    deferred: sort(deferred),
    orphan: assets.filter((a) => !reached.has(a) && !deferred.has(a)).sort(),
  };
}
