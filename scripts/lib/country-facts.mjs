// Real, sourced legal speed limits by country — the reason the network-pace
// deviation stat (03-map.mjs paceDeviation) looks the way it does. Germany's
// derestricted autobahn sections and Bulgaria/Poland's 140 km/h motorways are
// real regulatory facts, not flavour text, cross-checked against at least two
// independent sources per country (Wikipedia's speed-limits-by-country
// comparison plus a country-specific driving guide) rather than trusted from
// a single pull. Figures are the *standard* car limit for each road class;
// where a country runs a range (weather-dependent, phased rollouts, vehicle
// class) the commonly-quoted default is used and any notable exception is in
// `note`. Sourced August 2026 — speed limits do change (Poland raised its
// motorway limit from 130 to 140 in 2021; Czechia is mid-rollout of a 150
// km/h pilot section as of this writing) so this wants a re-check every
// couple of years, not a one-time fact.
//
// { motorway, rural, urban } in km/h. `motorway: null` means the country has
// no motorway network (Moldova).
export const COUNTRY_SPEED = {
  AL: { motorway: 110, rural: 90, urban: 40, note: 'newer stretches of the A1 run 130' },
  AT: { motorway: 130, rural: 100, urban: 50 },
  BA: { motorway: 130, rural: 80, urban: 50 },
  BE: { motorway: 120, rural: 90, urban: 50 },
  BG: { motorway: 140, rural: 90, urban: 50, note: 'joint-highest motorway limit in the EU, with Poland' },
  BY: { motorway: 120, rural: 90, urban: 60 },
  CH: { motorway: 120, rural: 80, urban: 50 },
  CZ: { motorway: 130, rural: 90, urban: 50 },
  DE: { motorway: null, rural: 100, urban: 50, note: 'no general motorway limit — advisory 130, one of the last countries in the world without one' },
  DK: { motorway: 130, rural: 80, urban: 50 },
  EE: { motorway: 110, rural: 90, urban: 50 },
  ES: { motorway: 120, rural: 90, urban: 50 },
  FI: { motorway: 100, rural: 80, urban: 50, note: 'raised to 120 on some motorways in summer' },
  FR: { motorway: 130, rural: 80, urban: 50, note: '110 on motorways when wet' },
  GR: { motorway: 130, rural: 80, urban: 50 },
  HR: { motorway: 130, rural: 80, urban: 50 },
  HU: { motorway: 130, rural: 90, urban: 50 },
  IT: { motorway: 130, rural: 90, urban: 50 },
  LT: { motorway: 120, rural: 90, urban: 50 },
  LU: { motorway: 130, rural: 90, urban: 50, note: '110 on motorways when wet' },
  LV: { motorway: 110, rural: 90, urban: 50 },
  MD: { motorway: null, rural: 90, urban: 50, note: 'no motorway network yet' },
  ME: { motorway: 100, rural: 80, urban: 50 },
  MK: { motorway: 120, rural: 90, urban: 50 },
  NL: { motorway: 130, rural: 80, urban: 50, note: 'cut to 100 in the daytime on many stretches for emissions' },
  NO: { motorway: 100, rural: 80, urban: 50, note: '110 only on the very best sections, mostly around Oslo' },
  PL: { motorway: 140, rural: 90, urban: 50, note: 'joint-highest motorway limit in the EU, with Bulgaria; raised from 130 in 2021' },
  PT: { motorway: 120, rural: 90, urban: 50 },
  RO: { motorway: 130, rural: 90, urban: 50, note: 'mountain roads often signed down to 80' },
  RS: { motorway: 130, rural: 80, urban: 50 },
  SE: { motorway: 110, rural: 80, urban: 50 },
  SI: { motorway: 130, rural: 90, urban: 50 },
  SK: { motorway: 130, rural: 90, urban: 50 },
  TR: { motorway: 120, rural: 90, urban: 50, note: 'a handful of private toll motorways/bridges run 140' },
  UA: { motorway: 130, rural: 90, urban: 50 },
  XK: { motorway: 130, rural: 80, urban: 50 },
};
