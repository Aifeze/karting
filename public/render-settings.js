// Les profils réduisent aussi la géométrie et les matériaux, pas seulement les effets.
export const RENDER_VERSION = "3";
export const RENDER_PROFILES = {
  low: {
    pixels: 420000,
    pixelRatio: 0.85,
    texture: 256,
    sceneryStep: 32,
    buildings: 90,
    distance: 155,
    roadStep: 5,
    particles: 60,
    weather: 0,
    lights: 0,
    anisotropy: 1,
  },
  balanced: {
    pixels: 850000,
    pixelRatio: 1,
    texture: 512,
    sceneryStep: 19,
    buildings: 200,
    distance: 240,
    roadStep: 3.5,
    particles: 140,
    weather: 240,
    lights: 1,
    anisotropy: 2,
  },
  high: {
    pixels: 1500000,
    pixelRatio: 1.25,
    texture: 1024,
    sceneryStep: 13,
    buildings: 320,
    distance: 330,
    roadStep: 2.5,
    particles: 240,
    weather: 500,
    lights: 2,
    anisotropy: 4,
  },
};
export const normalizeQuality = (value) =>
  Object.hasOwn(RENDER_PROFILES, value) ? value : "low";
export function renderRatio(width, height, dpr, quality, scale = 1) {
  const p = RENDER_PROFILES[normalizeQuality(quality)];
  return (
    Math.min(
      dpr || 1,
      p.pixelRatio,
      Math.sqrt(p.pixels / Math.max(1, width * height)),
    ) * scale
  );
}
