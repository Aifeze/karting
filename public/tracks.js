// Géométrie et règles de surface partagées. Aucun de ces calculs ne dirige le kart.
export const TAU = Math.PI * 2;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const mod = (n, d) => ((n % d) + d) % d;
export const angleDelta = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const TRACKS = [
  {
    id: "sunset",
    name: "Sunset Cliffs",
    number: "01",
    theme: "coast",
    tag: "FALAISES & ÉPINGLES",
    difficulty: 3,
    width: 16,
    description:
      "Corniches suspendues, lacets et grandes courbes au-dessus du lagon.",
    sky: "#94cadf",
    horizon: "#f9d6a5",
    fog: "#b4ccd0",
    accent: "#ff9364",
    road: "#555764",
    edge: "#fff1d1",
    fill: "#9dbda9",
    light: "#ffd7a0",
    exposure: 1.0,
    saturation: 1.13,
    rails: [
      [0, 0.09, 0],
      [0.29, 0.34, -1],
      [0.64, 0.7, 1],
    ],
    points: [
      [-180, 20, 150],
      [-80, 20, 150],
      [50, 24, 150],
      [140, 35, 110],
      [180, 46, 30],
      [120, 38, -20],
      [165, 30, -100],
      [90, 20, -180],
      [-20, 14, -190],
      [-80, 20, -130],
      [-20, 32, -70],
      [30, 44, -90],
      [45, 48, -30],
      [-30, 42, 15],
      [-120, 30, -10],
      [-180, 20, -80],
      [-240, 28, -60],
      [-235, 32, 40],
      [-260, 25, 110],
      [-240, 20, 150],
    ],
  },
  {
    id: "neon",
    name: "Neon Overdrive",
    number: "02",
    theme: "city",
    tag: "NUIT & DOUBLE NIVEAU",
    difficulty: 4,
    width: 15,
    description:
      "Un huit déstructuré entre les tours. Croisement à deux niveaux, 34 m de séparation.",
    sky: "#090d26",
    horizon: "#432c5c",
    fog: "#151b36",
    accent: "#4ff5ed",
    road: "#252d45",
    edge: "#eb60ce",
    fill: "#303969",
    light: "#8ca7ff",
    exposure: 1.12,
    saturation: 1.18,
    rails: [
      [0, 0.07, 0],
      [0.2, 0.26, 1],
      [0.71, 0.76, -1],
    ],
    points: [
      [-160, 12, 135],
      [-70, 14, 135],
      [10, 18, 120],
      [90, 26, 65],
      [0, 40, 0],
      [-90, 42, -65],
      [-155, 36, -140],
      [-70, 25, -190],
      [25, 20, -165],
      [120, 12, -100],
      [180, 10, -20],
      [105, 6, 60],
      [0, 6, 0],
      [-105, 8, -60],
      [-180, 12, -10],
      [-210, 14, 65],
      [-210, 12, 135],
    ],
  },
  {
    id: "volcano",
    name: "Inferno Caldera",
    number: "03",
    theme: "lava",
    tag: "LAVE & CHICANES",
    difficulty: 5,
    width: 14,
    description:
      "Basalte, braises et lacets étroits autour de la caldeira. Freinez avant les épingles.",
    sky: "#211524",
    horizon: "#d15c35",
    fog: "#4c2c32",
    accent: "#ff702d",
    road: "#383039",
    edge: "#ffc56f",
    fill: "#584246",
    light: "#ffb575",
    exposure: 1.05,
    saturation: 1.15,
    rails: [
      [0, 0.07, 0],
      [0.37, 0.41, -1],
      [0.79, 0.82, 1],
    ],
    points: [
      [-170, 30, 170],
      [-50, 32, 170],
      [80, 40, 160],
      [170, 58, 100],
      [150, 75, 10],
      [75, 86, 65],
      [20, 90, 20],
      [70, 85, -40],
      [140, 74, -80],
      [100, 58, -170],
      [-20, 43, -195],
      [-110, 40, -150],
      [-190, 55, -120],
      [-100, 67, -70],
      [-30, 70, -110],
      [10, 60, -55],
      [-40, 45, -10],
      [-130, 36, 30],
      [-200, 30, 90],
      [-230, 30, 150],
    ],
  },
  {
    id: "alpine",
    name: "Aurora Summit",
    number: "04",
    theme: "snow",
    tag: "GLACE & ALTITUDE",
    difficulty: 4,
    width: 16,
    description:
      "Un col à 124 m, des forêts givrées et une descente technique sous les aurores.",
    sky: "#172e5b",
    horizon: "#91c5db",
    fog: "#688cae",
    accent: "#9be9ff",
    road: "#7a98ae",
    edge: "#e5f8ff",
    fill: "#b5d9e4",
    light: "#c4ddff",
    exposure: 1.13,
    saturation: 1.05,
    rails: [
      [0, 0.08, 0],
      [0.34, 0.38, 1],
      [0.73, 0.78, -1],
    ],
    points: [
      [-180, 35, 170],
      [-60, 35, 170],
      [80, 40, 170],
      [190, 58, 110],
      [210, 82, 0],
      [135, 100, -45],
      [175, 112, -145],
      [70, 124, -210],
      [-40, 110, -200],
      [-140, 92, -130],
      [-80, 72, -80],
      [0, 56, -115],
      [45, 43, -50],
      [-10, 32, 5],
      [-95, 24, -15],
      [-190, 24, -70],
      [-245, 32, -20],
      [-210, 35, 80],
      [-250, 35, 150],
    ],
  },
];
export const DEFAULT_TRACK = "sunset";
const cache = new Map();
function curve(points, t) {
  const u = mod(t, 1) * points.length,
    i = Math.floor(u),
    f = u - i;
  const p = [-1, 0, 1, 2].map((k) => points[mod(i + k, points.length)]);
  return [0, 1, 2].map(
    (axis) =>
      0.5 *
      (2 * p[1][axis] +
        (-p[0][axis] + p[2][axis]) * f +
        (2 * p[0][axis] - 5 * p[1][axis] + 4 * p[2][axis] - p[3][axis]) *
          f *
          f +
        (-p[0][axis] + 3 * p[1][axis] - 3 * p[2][axis] + p[3][axis]) *
          f *
          f *
          f),
  );
}
export function getTrack(id = DEFAULT_TRACK) {
  const definition = TRACKS.find((t) => t.id === id) || TRACKS[0];
  if (cache.has(definition.id)) return cache.get(definition.id);
  const samples = [],
    count = definition.points.length * 64;
  let length = 0;
  for (let i = 0; i <= count; i++) {
    const [x, y, z] = curve(definition.points, i / count);
    if (i) {
      const p = samples[i - 1];
      length += Math.hypot(x - p.x, y - p.y, z - p.z);
    }
    samples.push({ x, y, z, s: length });
  }
  const grid = new Map(),
    cell = 32;
  for (let i = 0; i < count; i++) {
    const a = samples[i],
      b = samples[i + 1];
    for (
      let x = Math.floor(Math.min(a.x, b.x) / cell);
      x <= Math.floor(Math.max(a.x, b.x) / cell);
      x++
    )
      for (
        let z = Math.floor(Math.min(a.z, b.z) / cell);
        z <= Math.floor(Math.max(a.z, b.z) / cell);
        z++
      ) {
        const key = `${x},${z}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
  }
  const bounds = samples.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p.x),
      maxX: Math.max(b.maxX, p.x),
      minZ: Math.min(b.minZ, p.z),
      maxZ: Math.max(b.maxZ, p.z),
      minY: Math.min(b.minY, p.y),
      maxY: Math.max(b.maxY, p.y),
    }),
    {
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    },
  );
  const track = {
    ...definition,
    length,
    samples,
    grid,
    cell,
    bounds,
    halfWidth: definition.width / 2,
    supportWidth: definition.width / 2 + 1.8,
    checkpointCount: 32,
  };
  track.at = (distance, offset = 0) => trackAt(distance, offset, track);
  track.boxes = Array.from({ length: 7 }, (_, r) =>
    [-definition.width * 0.29, 0, definition.width * 0.29].map((offset) => ({
      s: length * (0.075 + r * 0.13),
      offset,
    })),
  ).flat();
  track.pads = [0.14, 0.43, 0.72, 0.91].map((f, i) => ({
    s: length * f,
    offset: i % 2 ? -3 : 3,
  }));
  track.oils = [0.23, 0.57, 0.84].map((f, i) => ({
    s: length * f,
    offset: i % 2 ? 2.5 : -2.5,
  }));
  cache.set(definition.id, track);
  return track;
}
export function loopDistance(a, b, length = getTrack().length) {
  const d = mod(a - b, length);
  return d > length / 2 ? d - length : d;
}
function basis(a, b, f, offset, track) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    d = Math.hypot(dx, dz),
    tx = dx / d,
    tz = dz / d;
  const s = a.s + (b.s - a.s) * f;
  // Dévers de faible amplitude : il modifie la surface, jamais le cap du joueur.
  const bank = Math.sin((s / track.length) * TAU * 3) * 0.065;
  return {
    x: a.x + (b.x - a.x) * f - tz * offset,
    y: a.y + (b.y - a.y) * f + Math.sin(bank) * offset,
    z: a.z + (b.z - a.z) * f + tx * offset,
    tx,
    tz,
    s,
    bank,
    heading: Math.atan2(tx, tz),
    slope: (b.y - a.y) / d,
    offset,
  };
}
export function trackAt(distance, offset = 0, track = getTrack()) {
  const s = mod(distance, track.length);
  let lo = 0,
    hi = track.samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track.samples[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = track.samples[lo],
    b = track.samples[hi];
  return basis(a, b, (s - a.s) / (b.s - a.s), offset, track);
}
// Choix 3D de la surface : un pont ne capture jamais le kart qui passe dessous.
export function projectTrack(track, x, y, z) {
  const ids = new Set(),
    cx = Math.floor(x / track.cell),
    cz = Math.floor(z / track.cell);
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const id of track.grid.get(`${cx + i},${cz + j}`) || []) ids.add(id);
  const candidates = ids.size ? ids : track.samples.slice(0, -1).keys();
  let best = null,
    bestScore = Infinity;
  for (const i of candidates) {
    const a = track.samples[i],
      b = track.samples[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z,
      len2 = dx * dx + dz * dz;
    const f = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1),
      px = a.x + dx * f,
      pz = a.z + dz * f;
    const offset = (-(x - px) * dz + (z - pz) * dx) / Math.sqrt(len2),
      p = basis(a, b, f, offset, track);
    const distance = Math.hypot(x - px, z - pz),
      score = distance * distance + (y - p.y) * (y - p.y) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = { ...p, distance, score };
    }
  }
  return best;
}
export function hasRail(track, s, side) {
  const f = mod(s, track.length) / track.length;
  return track.rails.some(
    ([a, b, which]) => f >= a && f <= b && (which === 0 || which === side),
  );
}
