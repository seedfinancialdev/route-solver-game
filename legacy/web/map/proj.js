/**
 * Lambert Conformal Conic Projection & Unprojection for Europe
 * Matches scripts/lib/proj.mjs exactly.
 */

const rad = (d) => (d * Math.PI) / 180;
export const PROJ = { lat1: 43, lat2: 62, lat0: 52, lon0: 15, R: 6371.0088 };

const { lat1, lat2, lat0, lon0, R } = PROJ;
const n = Math.log(Math.cos(rad(lat1)) / Math.cos(rad(lat2)))
  / Math.log(Math.tan(Math.PI / 4 + rad(lat2) / 2) / Math.tan(Math.PI / 4 + rad(lat1) / 2));
const F = (Math.cos(rad(lat1)) * Math.tan(Math.PI / 4 + rad(lat1) / 2) ** n) / n;
const rho0 = (R * F) / Math.tan(Math.PI / 4 + rad(lat0) / 2) ** n;

export function project(lon, lat) {
  const rho = (R * F) / Math.tan(Math.PI / 4 + rad(lat) / 2) ** n;
  const theta = n * rad(lon - lon0);
  return { x: rho * Math.sin(theta), y: rho * Math.cos(theta) - rho0 };
}

export function unproject(x, y) {
  const rho = Math.sign(n) * Math.hypot(x, rho0 + y);
  const theta = Math.atan2(x, rho0 + y);
  return {
    lon: lon0 + (theta / n) * (180 / Math.PI),
    lat: (2 * Math.atan(((R * F) / rho) ** (1 / n)) - Math.PI / 2) * (180 / Math.PI),
  };
}

/** Convert (lon, lat, zoom) -> XYZ tile indices {x, y, z} */
export function lonLatToTile(lon, lat, z) {
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  const latRad = rad(lat);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z)
  );
  return { x, y, z };
}

/** Convert XYZ tile indices {x, y, z} -> {minLon, maxLon, minLat, maxLat} bbox */
export function tileToLonLatBounds(x, y, z) {
  const n = Math.pow(2, z);
  const minLon = (x / n) * 360 - 180;
  const maxLon = ((x + 1) / n) * 360 - 180;

  const latRadMin = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const latRadMax = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));

  const minLat = (latRadMin * 180) / Math.PI;
  const maxLat = (latRadMax * 180) / Math.PI;

  return { minLon, maxLon, minLat, maxLat };
}
