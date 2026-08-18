export const R_EARTH_KM = 6371.0088;

const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. Both args need {lat, lon}. */
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(s));
}
