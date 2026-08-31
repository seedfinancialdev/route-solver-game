//
// Converts a real-world radius (meters) into a screen-pixel radius at a
// given map center latitude and zoom, using the standard Web Mercator
// meters-per-pixel formula. The fog-of-war overlay is CSS, not a map layer
// (see blind-gl.js) — it needs this to know how many pixels 300m is before
// it can draw a hole that size.
//
// This constant is calibrated to MapLibre GL JS's actual internal world,
// which is 512px-tile-based (worldSize = tileSize(512) * 2^zoom) — NOT the
// 256px-tile "slippy map" convention used by OSM/Google/Leaflet raster tiles.
// Mapbox GL JS / MapLibre GL JS's coordinate system is documented to differ
// from the OSM/Google convention by exactly 2x at the same zoom number
// (256 * 2^(z+1) == 512 * 2^z), so the equator meters-per-pixel-at-zoom-0
// value here is Earth's circumference divided by 512, not by 256.
const EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 = 78271.51696;

/** Real-world meters represented by one screen pixel, at this latitude and
 * zoom. Mercator projection stretches the map east-west away from the
 * equator, so the same zoom level represents fewer real meters per pixel at
 * higher latitudes — moving toward a pole makes a fixed pixel span "more
 * real ground" in appearance but actually cover fewer real meters. */
export function metersPerPixel(lat, zoom) {
  return (EQUATOR_METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / (2 ** zoom);
}

/** Screen-pixel radius that represents `meters` of real-world distance at
 * this latitude and zoom. */
export function metersToPixels(meters, lat, zoom) {
  return meters / metersPerPixel(lat, zoom);
}
