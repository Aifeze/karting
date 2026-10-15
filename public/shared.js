// Simulation déterministe, commune au navigateur et au serveur autoritaire.
import {
  getTrack,
  trackAt,
  projectTrack,
  hasRail,
  angleDelta,
  loopDistance,
  clamp,
  mod,
  TAU,
  DEFAULT_TRACK,
} from "./tracks.js";
export {
  getTrack,
  trackAt,
  projectTrack,
  hasRail,
  angleDelta,
  loopDistance,
  clamp,
  mod,
  TAU,
};
export const LAPS = 3;
export const RESPAWN_DELAY = 2.5;
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
export function makePlayer(
  id,
  name,
  color,
  bot = false,
  index = 0,
  track = getTrack(),
) {
  const s = -12 - Math.floor(index / 2) * 5,
    offset = index % 2 ? 2.4 : -2.4,
    at = track.at(s, offset);
  return {
    id,
    name,
    color,
    bot,
    x: at.x,
    y: at.y,
    z: at.z,
    yaw: at.heading,
    vx: 0,
    vy: 0,
    vz: 0,
    s,
    trackS: mod(s, track.length),
    offset,
    speed: 0,
    forwardSpeed: 0,
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
    resetHeld: false,
    lap: 1,
    rank: index + 1,
    grounded: true,
    falling: false,
    fallStartedAt: null,
    respawnAt: null,
    respawns: 0,
    invulnerable: 0,
    checkpoints: 0,
    bank: at.bank,
    slope: at.slope,
    safe: { s, checkpoints: 0 },
    wrongWay: false,
  };
}
export function createRace(people, seed = Date.now(), trackId = DEFAULT_TRACK) {
  const track = getTrack(trackId),
    players = people.map((p, i) =>
      makePlayer(p.id, p.name, p.color || COLORS[i], !!p.bot, i, track),
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
      makePlayer(`bot-${i}`, names[i - 1], COLORS[i], true, i, track),
    );
  }
  return {
    trackId: track.id,
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
function random(r) {
  r.seed = (Math.imul(r.seed, 1664525) + 1013904223) >>> 0;
  return r.seed / 4294967296;
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
    reset: value.reset === true,
  };
}
function event(r, type, p, extra = {}) {
  r.events.push({ type, player: p.id, at: r.clock, ...extra });
}
function hit(r, p, owner) {
  if (p.stun > 0 || p.falling || p.invulnerable > 0 || p.finishTime !== null)
    return;
  p.stun = 1.1;
  p.vx *= 0.3;
  p.vz *= 0.3;
  p.drift = 0;
  event(r, "hit", p, { owner });
}
export function beginFall(r, p, reason = "fall") {
  if (p.falling || p.finishTime !== null) return;
  p.falling = true;
  p.grounded = false;
  p.fallStartedAt = r.clock;
  p.respawnAt = r.clock + RESPAWN_DELAY;
  p.vy = Math.min(0, p.vy);
  p.drift = 0;
  p.boosting = 0;
  event(r, "fall", p, { reason, respawnAt: p.respawnAt });
}
function respawn(r, p, track) {
  const at = track.at(p.safe.s);
  Object.assign(p, {
    x: at.x,
    y: at.y,
    z: at.z,
    yaw: at.heading,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 0,
    forwardSpeed: 0,
    s: p.safe.s,
    trackS: mod(p.safe.s, track.length),
    offset: 0,
    steer: 0,
    drift: 0,
    boosting: 0,
    stun: 0,
    grounded: true,
    falling: false,
    fallStartedAt: null,
    respawnAt: null,
    invulnerable: 1.2,
    checkpoints: p.safe.checkpoints,
    bank: at.bank,
    slope: at.slope,
  });
  p.respawns++;
  event(r, "respawn", p);
}
export function useItem(r, p) {
  if (!p.item || p.stun > 0 || p.falling || p.finishTime !== null) return;
  const kind = p.item;
  if (kind === "turbo") p.boosting = Math.max(p.boosting, 2.4);
  else {
    const behind = kind === "banana" ? -4 : 4;
    r.hazards.push({
      id: r.nextHazard++,
      type: kind,
      x: p.x + Math.sin(p.yaw) * behind,
      y: p.y + 0.35,
      z: p.z + Math.cos(p.yaw) * behind,
      vx: Math.sin(p.yaw) * 68,
      vz: Math.cos(p.yaw) * 68,
      vy: 0,
      owner: p.id,
      ttl: kind === "banana" ? 28 : 7,
    });
  }
  p.item = null;
  event(r, "item", p, { kind });
}
// Seuls les adversaires IA calculent leurs propres commandes. Le joueur humain
// traverse exactement la même physique avec ses entrées, sans appel à ce contrôleur.
export function botInput(p, track) {
  const ahead = track.at(p.s + Math.max(9, p.speed * 0.65));
  const error = angleDelta(Math.atan2(ahead.x - p.x, ahead.z - p.z) - p.yaw);
  const a = track.at(p.s + 10),
    b = track.at(p.s + 32),
    curvature = Math.abs(angleDelta(b.heading - a.heading)) / 22;
  const desired = clamp(Math.sqrt(12 / Math.max(0.01, curvature)), 11, 31);
  return {
    throttle: p.speed < desired ? 1 : 0.08,
    brake: p.speed > desired + 2 ? 0.45 : 0,
    steer: clamp(-error * 2.6, -1, 1),
    drift: false,
    use: false,
    reset: false,
  };
}
function integrateKart(r, p, input, dt, track) {
  p.invulnerable = Math.max(0, p.invulnerable - dt);
  if (p.falling) {
    // Le délai part de la perte du support, et non d'une profondeur arbitraire.
    if (r.clock + 1e-9 >= p.respawnAt) {
      respawn(r, p, track);
      return;
    }
    p.vy -= 28 * dt;
    p.y += p.vy * dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.vx *= Math.exp(-dt * 0.12);
    p.vz *= Math.exp(-dt * 0.12);
    p.speed = Math.hypot(p.vx, p.vz);
    return;
  }
  if (input.reset && !p.resetHeld) {
    beginFall(r, p, "rescue");
    p.resetHeld = true;
    return;
  }
  p.resetHeld = input.reset;
  p.boosting = Math.max(0, p.boosting - dt);
  p.stun = Math.max(0, p.stun - dt);
  p.padTimer = Math.max(0, p.padTimer - dt);
  p.oilTimer = Math.max(0, p.oilTimer - dt);
  const offroad = Math.abs(p.offset) > track.halfWidth;
  const drifting =
    input.drift &&
    p.speed > 9 &&
    Math.abs(input.steer) > 0.12 &&
    !offroad &&
    p.stun <= 0;
  p.steer += (input.steer - p.steer) * Math.min(1, dt * 12);
  let forward = p.vx * Math.sin(p.yaw) + p.vz * Math.cos(p.yaw);
  // Modèle de direction de type bicyclette : aucune orientation issue du circuit.
  const steeringLock = drifting ? 0.72 : 0.54;
  const yawRate =
    ((-forward / 2.7) * Math.tan(p.steer * steeringLock)) /
    (1 + forward * forward * 0.0045);
  p.yaw = angleDelta(
    p.yaw + yawRate * dt + (p.stun > 0 ? Math.sin(p.stun * 18) * dt * 2 : 0),
  );
  let lateral = -p.vx * Math.cos(p.yaw) + p.vz * Math.sin(p.yaw);
  forward = p.vx * Math.sin(p.yaw) + p.vz * Math.cos(p.yaw);
  const grip = offroad ? 5 : drifting ? 2.1 : track.theme === "snow" ? 7.4 : 12;
  lateral *= Math.exp(-dt * grip);
  const max = offroad ? 14 : p.boosting > 0 ? 55 : 37;
  const engine = p.boosting > 0 ? 36 : 23;
  forward +=
    input.throttle *
    engine *
    Math.max(0, 1 - Math.pow(Math.max(0, forward) / max, 4)) *
    dt;
  if (input.brake > 0) {
    if (forward > 1) forward = Math.max(0, forward - input.brake * 38 * dt);
    else if (!input.throttle)
      forward = Math.max(-7, forward - input.brake * 10 * dt);
  }
  const drag =
    (offroad ? 3 : 1.1) +
    Math.abs(forward) * 0.025 +
    forward * forward * 0.0012;
  forward -= Math.sign(forward) * Math.min(Math.abs(forward), drag * dt);
  // Gravité dans les pentes ; elle influence la vitesse, jamais la direction.
  forward -= Math.sin(Math.atan(p.slope || 0)) * 7 * dt;
  if (p.stun > 0) forward *= Math.exp(-dt * 1.5);
  if (offroad && forward > 14) forward = Math.max(14, forward - dt * 24);
  p.vx = Math.sin(p.yaw) * forward - Math.cos(p.yaw) * lateral;
  p.vz = Math.cos(p.yaw) * forward + Math.sin(p.yaw) * lateral;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const surface = projectTrack(track, p.x, p.y, p.z);
  const side = Math.sign(surface.offset) || 1,
    rail = track.halfWidth + 0.85;
  if (
    hasRail(track, surface.s, side) &&
    Math.abs(surface.offset) > rail &&
    Math.abs(surface.offset) < rail + 2 &&
    Math.abs(p.y - surface.y) < 2
  ) {
    const penetration = Math.abs(surface.offset) - rail;
    const nx = -surface.tz * side,
      nz = surface.tx * side;
    p.x -= nx * penetration;
    p.z -= nz * penetration;
    const velocity = p.vx * nx + p.vz * nz;
    if (velocity > 0) {
      p.vx -= velocity * 1.3 * nx;
      p.vz -= velocity * 1.3 * nz;
    }
    surface.offset = side * rail;
    surface.distance = Math.abs(surface.offset);
  }
  p.offset = surface.offset;
  p.trackS = surface.s;
  p.bank = surface.bank;
  p.slope = surface.slope;
  if (
    surface.distance > track.supportWidth ||
    Math.abs(surface.y - p.y) > 3.5
  ) {
    beginFall(r, p);
    return;
  }
  p.y = surface.y;
  p.vy = 0;
  p.grounded = true;
  p.speed = Math.hypot(p.vx, p.vz);
  p.forwardSpeed = forward;
  const ds = loopDistance(surface.s, mod(p.s, track.length), track.length);
  const movingForward = p.vx * surface.tx + p.vz * surface.tz;
  p.wrongWay = movingForward < -3;
  if (Math.abs(ds) < Math.max(5, p.speed * dt * 2.5)) {
    const next = p.s + ds,
      gate = (p.checkpoints * track.length) / track.checkpointCount;
    // Chaque porte doit être franchie dans l'ordre : ni raccourci ni passage
    // inférieur d'un croisement ne valide une autre section du circuit.
    if (
      ds > 0 &&
      p.s < gate &&
      next >= gate &&
      Math.abs(p.offset) < track.halfWidth + 0.7
    )
      p.checkpoints++;
    p.s = next;
    if (
      Math.abs(p.offset) < track.halfWidth - 1 &&
      movingForward > 0 &&
      p.s > p.safe.s + 5
    )
      p.safe = {
        s: p.s - 3,
        checkpoints: Math.min(
          p.checkpoints,
          Math.max(
            0,
            Math.floor(((p.s - 3) / track.length) * track.checkpointCount) + 1,
          ),
        ),
      };
  }
  if (drifting) p.drift = Math.min(3, p.drift + dt);
  else if (p.drift > 0) {
    if (p.drift > 0.65) {
      p.boosting = Math.max(p.boosting, p.drift > 1.8 ? 1.65 : 0.9);
      event(r, "driftBoost", p);
    }
    p.drift = 0;
  }
  if (input.use && !p.itemHeld) useItem(r, p);
  p.itemHeld = input.use;
}
function pickupInteractions(r, p, track) {
  if (p.falling) return;
  const near = (s, offset, radius) => {
    const at = track.at(s, offset);
    return (
      Math.abs(p.y - at.y) < 2 && Math.hypot(p.x - at.x, p.z - at.z) < radius
    );
  };
  for (let i = 0; i < track.boxes.length; i++) {
    const b = track.boxes[i];
    if (
      !p.item &&
      (p.boxTimers[i] || 0) < r.clock &&
      near(b.s, b.offset, 2.5)
    ) {
      p.item = ["turbo", "banana", "green", "red"][Math.floor(random(r) * 4)];
      p.boxTimers[i] = r.clock + 12;
      event(r, "pickup", p, { kind: p.item });
    }
  }
  for (const pad of track.pads)
    if (!p.padTimer && near(pad.s, pad.offset, 3)) {
      p.boosting = Math.max(p.boosting, 1.5);
      p.padTimer = 2;
      event(r, "pad", p);
    }
  for (const oil of track.oils)
    if (!p.oilTimer && near(oil.s, oil.offset, 2.5)) {
      hit(r, p, "oil");
      p.oilTimer = 3;
    }
}
function hazards(r, track, dt) {
  for (const h of r.hazards) {
    h.ttl -= dt;
    if (h.type !== "banana") {
      if (h.type === "red") {
        const targets = r.players
          .filter(
            (p) =>
              p.id !== h.owner &&
              !p.falling &&
              p.finishTime === null &&
              Math.abs(p.y - h.y) < 8 &&
              (p.x - h.x) * h.vx + (p.z - h.z) * h.vz > 0,
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - h.x, a.z - h.z) -
              Math.hypot(b.x - h.x, b.z - h.z),
          );
        const target = targets[0];
        if (target) {
          const dx = target.x - h.x,
            dz = target.z - h.z,
            d = Math.hypot(dx, dz);
          h.vx += ((dx / d) * 68 - h.vx) * Math.min(1, dt * 5);
          h.vz += ((dz / d) * 68 - h.vz) * Math.min(1, dt * 5);
        }
      }
      h.x += h.vx * dt;
      h.z += h.vz * dt;
      const at = projectTrack(track, h.x, h.y, h.z);
      if (at.distance < track.supportWidth && Math.abs(at.y + 0.35 - h.y) < 4)
        h.y = at.y + 0.35;
      else {
        h.vy -= 28 * dt;
        h.y += h.vy * dt;
      }
    }
    for (const p of r.players)
      if (
        p.id !== h.owner &&
        !p.falling &&
        p.invulnerable <= 0 &&
        p.stun <= 0 &&
        Math.abs(p.y + 0.35 - h.y) < 1.7 &&
        Math.hypot(p.x - h.x, p.z - h.z) < 1.9
      ) {
        hit(r, p, h.owner);
        h.ttl = 0;
        break;
      }
  }
  r.hazards = r.hazards.filter((h) => h.ttl > 0 && h.y > -100);
}
export function stepRace(r, inputMap = {}, delta = 1 / 60) {
  const dt = clamp(delta, 0, 0.05),
    track = getTrack(r.trackId);
  r.events = [];
  r.clock += dt;
  if (r.phase === "countdown") {
    r.countdown -= dt;
    if (r.countdown <= 0) {
      r.phase = "racing";
      event(r, "go", { id: "" });
    }
    return;
  }
  if (r.phase !== "racing") return;
  r.elapsed += dt;
  for (const p of r.players) {
    if (p.finishTime !== null) {
      p.speed = 0;
      continue;
    }
    let input = sanitizeInput(inputMap[p.id]);
    if (p.bot) {
      input = botInput(p, track);
      input.use = !!p.item && random(r) < dt * 0.8;
    }
    integrateKart(r, p, input, dt, track);
    pickupInteractions(r, p, track);
    const lap = Math.min(LAPS, Math.max(1, Math.floor(p.s / track.length) + 1));
    if (lap > p.lap) event(r, "lap", p, { lap });
    p.lap = lap;
    if (
      p.s >= track.length * LAPS &&
      p.checkpoints >= track.checkpointCount * LAPS + 1
    ) {
      p.finishTime = r.elapsed;
      event(r, "finish", p);
    }
  }
  for (let i = 0; i < r.players.length; i++)
    for (let j = i + 1; j < r.players.length; j++) {
      const a = r.players[i],
        b = r.players[j];
      if (
        a.falling ||
        b.falling ||
        a.invulnerable > 0 ||
        b.invulnerable > 0 ||
        a.finishTime !== null ||
        b.finishTime !== null ||
        Math.abs(a.y - b.y) > 1.5
      )
        continue;
      const dx = a.x - b.x,
        dz = a.z - b.z,
        d = Math.hypot(dx, dz);
      if (d < 1.9 && d > 0.01) {
        const force = (1.9 - d) * 0.5,
          nx = dx / d,
          nz = dz / d;
        a.x += nx * force;
        a.z += nz * force;
        b.x -= nx * force;
        b.z -= nz * force;
        const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (closing < 0) {
          a.vx -= closing * 0.5 * nx;
          a.vz -= closing * 0.5 * nz;
          b.vx += closing * 0.5 * nx;
          b.vz += closing * 0.5 * nz;
        }
      }
    }
  hazards(r, track, dt);
  [...r.players]
    .sort(
      (a, b) =>
        (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) || b.s - a.s,
    )
    .forEach((p, i) => (p.rank = i + 1));
  if (r.players.every((p) => p.finishTime !== null) || r.elapsed >= 600)
    r.phase = "finished";
}
export function snapshot(r) {
  return {
    trackId: r.trackId,
    phase: r.phase,
    countdown: r.countdown,
    elapsed: r.elapsed,
    clock: r.clock,
    players: r.players.map((p) => ({
      ...p,
      safe: { ...p.safe },
      boxTimers: { ...p.boxTimers },
    })),
    hazards: r.hazards.map((h) => ({ ...h })),
    events: [...r.events],
  };
}
