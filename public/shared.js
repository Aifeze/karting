// Simulation commune au navigateur et au serveur. Le serveur décide des résultats.
export const TAU = Math.PI * 2;
export const TRACK_WIDTH = 18;
export const LAPS = 3;
export const COLORS = [
  "#ff7045",
  "#a9e9c4",
  "#a7a2f5",
  "#f9d567",
  "#71c9f4",
  "#f28cbd",
  "#e2e5ed",
  "#88c973",
];
export const ITEMS = {
  turbo: { label: "Turbo", icon: "ϟ", color: "#9fe8ef" },
  banana: { label: "Banane", icon: "◡", color: "#f9d567" },
  green: { label: "Carapace verte", icon: "⬡", color: "#a9e9c4" },
  red: { label: "Carapace rouge", icon: "⬡", color: "#ff8a78" },
};
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const mod = (n, d) => ((n % d) + d) % d;

function curve(t) {
  const a = t * TAU;
  return {
    x: Math.sin(a) * (95 + 18 * Math.cos(a * 3)) + 12 * Math.sin(a * 2),
    y: 4 + 4 * Math.sin(a * 2) + 3 * Math.cos(a * 3),
    z: Math.cos(a) * (125 + 14 * Math.sin(a * 2)),
    bank: Math.sin(a * 3) * 0.095,
  };
}
const samples = [];
let length = 0;
for (let i = 0; i <= 2048; i++) {
  const p = curve(i / 2048);
  if (i)
    length += Math.hypot(
      p.x - samples[i - 1].x,
      p.y - samples[i - 1].y,
      p.z - samples[i - 1].z,
    );
  samples.push({ ...p, s: length });
}
export const TRACK_LENGTH = length;
export function trackAt(distance, offset = 0) {
  const s = mod(distance, length);
  let lo = 0,
    hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = samples[lo],
    b = samples[hi];
  const f = (s - a.s) / (b.s - a.s);
  const dx = b.x - a.x,
    dz = b.z - a.z,
    d = Math.hypot(dx, dz);
  const tx = dx / d,
    tz = dz / d,
    bank = a.bank + (b.bank - a.bank) * f;
  return {
    x: a.x + (b.x - a.x) * f - tz * offset,
    y: a.y + (b.y - a.y) * f + Math.sin(bank) * offset,
    z: a.z + (b.z - a.z) * f + tx * offset,
    tx,
    tz,
    bank,
    heading: Math.atan2(tx, tz),
  };
}
export const BOXES = Array.from({ length: 5 }, (_, row) =>
  [-5, 0, 5].map((offset) => ({ s: length * (0.08 + row * 0.19), offset })),
).flat();
export const PADS = [
  { s: length * 0.17, offset: -3.8 },
  { s: length * 0.48, offset: 3.8 },
  { s: length * 0.81, offset: 0 },
];
export const OILS = [
  { s: length * 0.31, offset: -2.8 },
  { s: length * 0.68, offset: 3 },
];
export function loopDistance(a, b) {
  let d = mod(a - b, length);
  return d > length / 2 ? d - length : d;
}
export function makePlayer(id, name, color, bot = false, index = 0) {
  return {
    id,
    name,
    color,
    bot,
    s: -10 - Math.floor(index / 2) * 5,
    offset: index % 2 ? 2.5 : -2.5,
    speed: 0,
    angle: 0,
    steer: 0,
    drift: 0,
    boosting: 0,
    stun: 0,
    item: null,
    finishTime: null,
    boxTimers: {},
    padTimer: 0,
    oilTimer: 0,
    itemHeld: false,
    lap: 1,
    rank: index + 1,
  };
}
export function createRace(people, seed = Date.now()) {
  const players = people.map((p, i) =>
    makePlayer(p.id, p.name, p.color || COLORS[i], !!p.bot, i),
  );
  const names = [
    "Mochi",
    "Ziggy",
    "Pistache",
    "Rocket",
    "Coco",
    "Pixel",
    "Nova",
  ];
  while (players.length < 4) {
    const i = players.length;
    players.push(
      makePlayer(`bot-${i}`, names[i - 1] || "Coco", COLORS[i], true, i),
    );
  }
  return {
    players,
    phase: "countdown",
    countdown: 3.2,
    elapsed: 0,
    clock: 0,
    hazards: [],
    events: [],
    seed: seed >>> 0 || 1,
    nextHazard: 1,
  };
}
function random(race) {
  race.seed = (Math.imul(race.seed, 1664525) + 1013904223) >>> 0;
  return race.seed / 4294967296;
}
export function sanitizeInput(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    throttle: clamp(number(value.throttle), 0, 1),
    brake: clamp(number(value.brake), 0, 1),
    steer: clamp(number(value.steer), -1, 1),
    drift: value.drift === true,
    use: value.use === true,
  };
}
function event(race, type, player, extra = {}) {
  race.events.push({ type, player: player.id, at: race.clock, ...extra });
}
function hit(race, player, owner) {
  if (player.stun > 0 || player.finishTime !== null) return;
  player.stun = 1.15;
  player.speed *= 0.3;
  player.drift = 0;
  event(race, "hit", player, { owner });
}
export function useItem(race, p) {
  if (!p.item || p.stun > 0 || p.finishTime !== null) return;
  const kind = p.item;
  if (kind === "turbo") p.boosting = Math.max(p.boosting, 2.4);
  else
    race.hazards.push({
      id: race.nextHazard++,
      type: kind,
      s: p.s + (kind === "banana" ? -4 : 5),
      offset: p.offset,
      owner: p.id,
      ttl: kind === "banana" ? 28 : 7,
    });
  p.item = null;
  event(race, "item", p, { kind });
}
export function stepRace(race, inputMap, delta) {
  const dt = clamp(delta, 0, 0.05);
  race.events = [];
  race.clock += dt;
  if (race.phase === "countdown") {
    race.countdown -= dt;
    if (race.countdown <= 0) {
      race.phase = "racing";
      event(race, "go", { id: "" });
    }
    return;
  }
  if (race.phase !== "racing") return;
  race.elapsed += dt;
  for (const p of race.players) {
    if (p.finishTime !== null) {
      p.speed = Math.max(0, p.speed - dt * 14);
      continue;
    }
    let input = sanitizeInput(inputMap[p.id]);
    if (p.bot) {
      // Les bots suivent une trajectoire différente et utilisent les mêmes objets.
      const lane =
        Math.sin(p.s * 0.015 + Number(p.id.replace(/\D/g, "") || 1) * 2) * 4;
      input = {
        throttle: 0.88 + Math.sin(p.s * 0.01) * 0.06,
        brake: 0,
        steer: clamp((lane - p.offset) * 0.18 - p.angle * 2, -1, 1),
        drift: false,
        use: !!p.item && random(race) < dt * 0.8,
      };
    }
    p.boosting = Math.max(0, p.boosting - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.padTimer = Math.max(0, p.padTimer - dt);
    p.oilTimer = Math.max(0, p.oilTimer - dt);
    const offroad = Math.abs(p.offset) > TRACK_WIDTH / 2;
    const drifting =
      input.drift &&
      p.speed > 9 &&
      Math.abs(input.steer) > 0.12 &&
      !offroad &&
      p.stun <= 0;
    p.steer += (input.steer - p.steer) * Math.min(1, dt * 9);
    p.angle +=
      p.steer * dt * (drifting ? 1.35 : 0.92) * Math.min(1, p.speed / 6);
    p.angle *= Math.exp(-dt * (drifting ? 1.5 : 2.8));
    p.angle = clamp(p.angle, -0.67, 0.67);
    if (drifting) p.drift = Math.min(3, p.drift + dt);
    else if (p.drift > 0) {
      if (p.drift > 0.65) {
        p.boosting = Math.max(p.boosting, p.drift > 1.8 ? 1.65 : 0.9);
        event(race, "driftBoost", p);
      }
      p.drift = 0;
    }
    const max = p.stun > 0 ? 7 : offroad ? 12 : p.boosting > 0 ? 52 : 34;
    const acceleration = p.boosting > 0 && !offroad ? 32 : 17;
    p.speed +=
      (input.throttle * acceleration -
        input.brake * 30 -
        2.5 -
        p.speed * 0.12) *
      dt;
    if (p.speed > max)
      p.speed = Math.max(max, p.speed - dt * (offroad ? 32 : 16));
    p.speed = clamp(p.speed, 0, 55);
    if (p.stun > 0) p.angle = Math.sin(p.stun * 16) * 0.32;
    p.s += p.speed * Math.cos(p.angle) * dt;
    p.offset = clamp(p.offset + p.speed * Math.sin(p.angle) * dt, -18, 18);
    if (Math.abs(p.offset) >= 18) {
      p.angle *= -0.3;
      p.speed *= 0.98;
    }
    if (input.use && !p.itemHeld) useItem(race, p);
    p.itemHeld = input.use;
    for (let i = 0; i < BOXES.length; i++) {
      const b = BOXES[i];
      if (
        !p.item &&
        (p.boxTimers[i] || 0) < race.clock &&
        Math.abs(loopDistance(p.s, b.s)) < 2.4 &&
        Math.abs(p.offset - b.offset) < 2.1
      ) {
        const kinds = ["turbo", "banana", "green", "red"];
        p.item = kinds[Math.floor(random(race) * kinds.length)];
        p.boxTimers[i] = race.clock + 12;
        event(race, "pickup", p, { kind: p.item });
      }
    }
    for (const pad of PADS)
      if (
        !p.padTimer &&
        Math.abs(loopDistance(p.s, pad.s)) < 4 &&
        Math.abs(p.offset - pad.offset) < 2.5
      ) {
        p.boosting = Math.max(p.boosting, 1.5);
        p.padTimer = 2;
        event(race, "pad", p);
      }
    for (const oil of OILS)
      if (
        !p.oilTimer &&
        Math.abs(loopDistance(p.s, oil.s)) < 2.5 &&
        Math.abs(p.offset - oil.offset) < 2
      ) {
        hit(race, p, "oil");
        p.oilTimer = 3;
      }
    const lap = Math.min(LAPS, Math.max(1, Math.floor(p.s / length) + 1));
    if (lap > p.lap) event(race, "lap", p, { lap });
    p.lap = lap;
    if (p.s >= length * LAPS) {
      p.finishTime = race.elapsed;
      event(race, "finish", p);
    }
  }
  // Petits contacts entre karts : pas de téléportation ni de blocage du peloton.
  for (let i = 0; i < race.players.length; i++)
    for (let j = i + 1; j < race.players.length; j++) {
      const a = race.players[i],
        b = race.players[j];
      if (a.finishTime !== null || b.finishTime !== null) continue;
      if (
        Math.abs(loopDistance(a.s, b.s)) < 2.4 &&
        Math.abs(a.offset - b.offset) < 1.7
      ) {
        const push = (a.offset >= b.offset ? 1 : -1) * dt * 5;
        a.offset += push;
        b.offset -= push;
        const front = a.s > b.s ? a : b,
          back = front === a ? b : a;
        if (back.speed > front.speed)
          back.speed = Math.max(front.speed, back.speed - dt * 10);
      }
    }
  for (const h of race.hazards) {
    h.ttl -= dt;
    if (h.type !== "banana") {
      h.s += dt * (h.type === "red" ? 62 : 58);
      if (h.type === "red") {
        const target = race.players
          .filter(
            (p) =>
              p.id !== h.owner &&
              p.finishTime === null &&
              loopDistance(p.s, h.s) > 0,
          )
          .sort((a, b) => loopDistance(a.s, h.s) - loopDistance(b.s, h.s))[0];
        if (target)
          h.offset += clamp(target.offset - h.offset, -dt * 10, dt * 10);
      }
    }
    for (const p of race.players)
      if (
        p.id !== h.owner &&
        p.stun <= 0 &&
        Math.abs(loopDistance(p.s, h.s)) < 2.4 &&
        Math.abs(p.offset - h.offset) < 1.7
      ) {
        hit(race, p, h.owner);
        h.ttl = 0;
        break;
      }
  }
  race.hazards = race.hazards.filter((h) => h.ttl > 0);
  const sorted = [...race.players].sort(
    (a, b) =>
      (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || b.s - a.s,
  );
  sorted.forEach((p, i) => (p.rank = i + 1));
  if (race.players.every((p) => p.finishTime !== null) || race.elapsed > 300)
    race.phase = "finished";
}
export function snapshot(race) {
  return {
    phase: race.phase,
    countdown: race.countdown,
    elapsed: race.elapsed,
    clock: race.clock,
    players: race.players.map((p) => ({ ...p })),
    hazards: race.hazards.map((h) => ({ ...h })),
    events: [...race.events],
  };
}
