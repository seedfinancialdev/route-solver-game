// Lambert conformal conic, tuned for Europe. Used for two things that must
// agree: the Delaunay triangulation that defines adjacency, and the SVG map.
// If they used different projections the "nearby cities" would not look nearby.

const rad = (d) => (d * Math.PI) / 180;

export const PROJ = { lat1: 43, lat2: 62, lat0: 52, lon0: 15, R: 6371.0088 };

const { lat1, lat2, lat0, lon0, R } = PROJ;
const n = Math.log(Math.cos(rad(lat1)) / Math.cos(rad(lat2)))
  / Math.log(Math.tan(Math.PI / 4 + rad(lat2) / 2) / Math.tan(Math.PI / 4 + rad(lat1) / 2));
const F = (Math.cos(rad(lat1)) * Math.tan(Math.PI / 4 + rad(lat1) / 2) ** n) / n;
const rho0 = (R * F) / Math.tan(Math.PI / 4 + rad(lat0) / 2) ** n;

/** lon/lat degrees -> {x, y} in km, y already flipped so +y is south (screen order). */
export function project(lon, lat) {
  const rho = (R * F) / Math.tan(Math.PI / 4 + rad(lat) / 2) ** n;
  const theta = n * rad(lon - lon0);
  return { x: rho * Math.sin(theta), y: rho0 - rho * Math.cos(theta) };
}
