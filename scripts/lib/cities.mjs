// The country set and bounding box that define "the game's Europe" — shared
// between 00-cities.mjs (which picks the playable roster) and 03-map.mjs
// (which, for the decorative background towns, needs to know which GeoNames
// rows would have been *candidates* even though they weren't picked). Kept in
// one place so the two never drift apart.

// The continental landmass only. Britain and Ireland are excluded along with
// Iceland/Malta/Cyprus: every route onto them runs through a ferry or the
// Chunnel, and a sea hop is exactly the cost a player cannot reason about from
// a boundary map. Sicily, Sardinia and Crete drop out on their own once ferry
// edges are rejected. Russia is excluded because only Kaliningrad and
// St Petersburg would qualify and both distort the graph.
export const COUNTRIES = new Map(Object.entries({
  PT: 'Portugal', ES: 'Spain', FR: 'France', BE: 'Belgium', NL: 'Netherlands',
  LU: 'Luxembourg', DE: 'Germany', CH: 'Switzerland', AT: 'Austria', IT: 'Italy',
  DK: 'Denmark', NO: 'Norway', SE: 'Sweden',
  FI: 'Finland', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', PL: 'Poland',
  CZ: 'Czechia', SK: 'Slovakia', HU: 'Hungary', SI: 'Slovenia', HR: 'Croatia',
  BA: 'Bosnia and Herzegovina', RS: 'Serbia', ME: 'Montenegro', MK: 'North Macedonia',
  AL: 'Albania', GR: 'Greece', BG: 'Bulgaria', RO: 'Romania', MD: 'Moldova',
  UA: 'Ukraine', BY: 'Belarus', TR: 'Turkey', XK: 'Kosovo',
}));

// Keeps Turkey to Thrace + the Aegean coast rather than dragging the graph
// across Anatolia, and drops Ukrainian/Belarusian cities far past the Dnipro.
export const BBOX = { minLon: -11, maxLon: 33, minLat: 35, maxLat: 71 };

/** True for any GeoNames cities15000 row inside the game's Europe, picked or not. */
export function inGameEurope({ featClass, country, lat, lon, population }) {
  if (featClass !== 'P') return false;
  if (!COUNTRIES.has(country)) return false;
  if (lon < BBOX.minLon || lon > BBOX.maxLon) return false;
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return false;
  return Boolean(population);
}

/** Parse one tab-separated cities15000.txt row into the fields inGameEurope needs. */
export function parseRow(line) {
  const f = line.split('\t');
  const [geonameid, name, , , lat, lon, featClass, , country] = f;
  return {
    id: Number(geonameid), name, country, featClass,
    lat: Number(lat), lon: Number(lon), population: Number(f[14]),
  };
}
