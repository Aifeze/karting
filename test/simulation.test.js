import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRace,
  stepRace,
  trackAt,
  getTrack,
  projectTrack,
  sanitizeInput,
  useItem,
  LAPS,
  RESPAWN_DELAY,
  angleDelta,
} from "../public/shared.js";
import { TRACKS } from "../public/tracks.js";
const fresh = (id = "sunset") => {
  const r = createRace([{ id: "human", name: "Toto" }], 42, id);
  r.phase = "racing";
  r.players.slice(1).forEach((p) => (p.finishTime = 1));
  return r;
};
const tick = (r, n, input = { throttle: 1 }, hz = 60) => {
  for (let i = 0; i < n; i++) stepRace(r, { human: input }, 1 / hz);
};
function place(r, s, offset = 0, speed = 0, yaw) {
  const t = getTrack(r.trackId),
    p = r.players[0],
    at = t.at(s, offset);
  Object.assign(p, {
    x: at.x,
    y: at.y,
    z: at.z,
    yaw: yaw ?? at.heading,
    vx: Math.sin(yaw ?? at.heading) * speed,
    vz: Math.cos(yaw ?? at.heading) * speed,
    vy: 0,
    speed,
    forwardSpeed: speed,
    s,
    trackS: at.s,
    offset,
    bank: at.bank,
    slope: at.slope,
    checkpoints: Math.max(
      0,
      Math.floor((s / t.length) * t.checkpointCount) + 1,
    ),
    safe: {
      s: s - 3,
      checkpoints: Math.max(
        0,
        Math.floor(((s - 3) / t.length) * t.checkpointCount) + 1,
      ),
    },
  });
  return p;
}
for (const definition of TRACKS)
  test(`${definition.name} : tracé fermé, long, dénivelé et surface continue`, () => {
    const t = getTrack(definition.id),
      a = t.at(0),
      b = t.at(t.length);
    assert.deepEqual(a, b);
    assert.ok(t.length > 1600);
    assert.ok(t.bounds.maxY - t.bounds.minY > 30);
    assert.ok(Math.hypot(t.at(-0.01).x - a.x, t.at(-0.01).z - a.z) < 0.02);
    for (let s = 0; s < t.length; s += 27) {
      const p = t.at(s, 2),
        projection = projectTrack(t, p.x, p.y, p.z);
      assert.ok(Math.abs(Math.hypot(p.tx, p.tz) - 1) < 1e-10);
      assert.ok(Math.abs(projection.y - p.y) < 0.1);
      assert.ok(Math.abs(projection.offset - 2) < 0.15);
    }
  });
test("les entrées réseau sont strictement typées et bornées", () => {
  assert.deepEqual(sanitizeInput(null), {
    throttle: 0,
    brake: 0,
    steer: 0,
    drift: false,
    use: false,
    reset: false,
  });
  assert.equal(sanitizeInput({ throttle: Infinity, steer: -300 }).throttle, 0);
  assert.equal(sanitizeInput({ steer: -300 }).steer, -1);
  assert.equal(
    sanitizeInput({ throttle: { toString: null, valueOf: null } }).throttle,
    0,
  );
});
test("le compte à rebours bloque les commandes puis accélération, freinage et marche arrière fonctionnent", () => {
  const r = createRace([{ id: "human" }], 42),
    p = r.players[0],
    start = { x: p.x, z: p.z };
  tick(r, 120);
  assert.equal(p.x, start.x);
  assert.equal(p.z, start.z);
  assert.equal(p.speed, 0);
  tick(r, 180);
  assert.ok(p.speed > 15);
  const speed = p.speed;
  tick(r, 25, { brake: 1 });
  assert.ok(p.speed < speed - 8);
  tick(r, 150, { brake: 1 });
  assert.ok(p.forwardSpeed < 0);
});
test("zéro assistance : le kart conserve son cap et sa trajectoire rectiligne dans un virage", () => {
  const r = fresh(),
    t = getTrack(),
    p = place(r, t.length * 0.195, 0, 22),
    yaw = p.yaw,
    x = p.x,
    z = p.z;
  tick(r, 30, { throttle: 1 });
  assert.equal(p.yaw, yaw, "la piste ne doit jamais changer le cap sans input");
  const side = -(p.x - x) * Math.cos(yaw) + (p.z - z) * Math.sin(yaw);
  assert.ok(
    Math.abs(side) < 1e-8,
    "la vitesse reste dans la direction choisie",
  );
  assert.ok(Math.hypot(p.x - x, p.z - z) > 9);
});
test("la direction manuelle change réellement le cap ; le drift conserve une glisse latérale", () => {
  const r = fresh(),
    p = place(r, 30, -2, 18),
    yaw = p.yaw;
  tick(r, 18, { throttle: 1, steer: 0.6 });
  assert.ok(angleDelta(p.yaw - yaw) < -0.1);
  const d = fresh(),
    q = place(d, 30, -2, 18);
  let peakSlip = 0;
  for (let i = 0; i < 58; i++) {
    stepRace(
      d,
      {
        human: { throttle: 1, drift: true, steer: i % 20 < 10 ? 0.45 : -0.45 },
      },
      1 / 60,
    );
    peakSlip = Math.max(
      peakSlip,
      Math.abs(-q.vx * Math.cos(q.yaw) + q.vz * Math.sin(q.yaw)),
    );
  }
  assert.ok(q.drift > 0.7);
  assert.ok(peakSlip > 0.5);
  stepRace(d, { human: { throttle: 1 } }, 1 / 60);
  assert.ok(q.boosting > 0.8);
});
for (const hz of [30, 60])
  test(`chute libre et réapparition strictement après 2,5 s à ${hz} Hz`, () => {
    const r = fresh(),
      t = getTrack(),
      p = place(r, t.length * 0.18, t.supportWidth + 0.4, 15);
    stepRace(r, {}, 1 / hz);
    assert.ok(p.falling);
    const start = r.clock,
      y = p.y,
      safe = { ...p.safe };
    assert.ok(Math.abs(p.respawnAt - start - RESPAWN_DELAY) < 1e-10);
    tick(r, hz * RESPAWN_DELAY - 1, {}, hz);
    assert.ok(p.falling, "pas de retour anticipé");
    assert.ok(p.y < y - 60, "la gravité doit agir pendant la chute");
    stepRace(r, {}, 1 / hz);
    assert.equal(p.falling, false);
    assert.equal(p.respawns, 1);
    assert.ok(Math.abs(r.clock - start - 2.5) < 1e-8);
    assert.equal(p.speed, 0);
    assert.equal(p.s, safe.s);
    assert.equal(p.checkpoints, safe.checkpoints);
    const at = t.at(safe.s);
    assert.equal(p.x, at.x);
    assert.equal(p.y, at.y);
    assert.equal(p.yaw, at.heading);
  });
test("le rappel manuel utilise le même délai sans fournir de raccourci", () => {
  const r = fresh(),
    p = place(r, 70, 0, 10);
  stepRace(r, { human: { reset: true } }, 1 / 60);
  assert.ok(p.falling);
  tick(r, 150, { reset: true });
  assert.equal(p.respawns, 1);
  assert.ok(p.s <= 70);
  tick(r, 5, { reset: true });
  assert.equal(p.falling, false, "maintenir R ne doit pas boucler les rappels");
});
test("un croisement distingue le tablier supérieur et la route inférieure", () => {
  const t = getTrack("neon"),
    upper = t.samples[4 * 64],
    lower = t.samples[12 * 64];
  assert.ok(
    Math.abs(upper.x - lower.x) < 1e-8 && Math.abs(upper.z - lower.z) < 1e-8,
  );
  assert.equal(upper.y - lower.y, 34);
  const a = projectTrack(t, upper.x, upper.y, upper.z),
    b = projectTrack(t, lower.x, lower.y, lower.z);
  assert.ok(Math.abs(a.s - upper.s) < 0.01);
  assert.ok(Math.abs(b.s - lower.s) < 0.01);
  const r = fresh("neon"),
    p = place(r, upper.s, 0, 0);
  stepRace(r, {}, 1 / 60);
  assert.ok(Math.abs(p.y - upper.y) < 0.02);
  assert.equal(p.falling, false);
  const other = r.players[1];
  other.finishTime = null;
  other.bot = false;
  Object.assign(other, { x: lower.x, y: lower.y, z: lower.z });
  p.item = "banana";
  useItem(r, p);
  stepRace(r, {}, 1 / 60);
  assert.equal(other.stun, 0, "aucune collision entre niveaux");
});
test("une glissière visible repousse le kart sans changer son cap", () => {
  const r = fresh(),
    t = getTrack(),
    p = place(r, t.length * 0.025, t.halfWidth + 1.05, 12),
    yaw = p.yaw;
  stepRace(r, {}, 1 / 60);
  assert.equal(p.falling, false);
  assert.ok(Math.abs(p.offset) <= t.halfWidth + 0.85 + 1e-8);
  assert.equal(p.yaw, yaw);
});
test("les checkpoints empêchent de sauter une section ou de gagner en téléportant la position", () => {
  const r = fresh(),
    t = getTrack(),
    p = r.players[0],
    at = t.at(t.length * 0.8);
  Object.assign(p, { x: at.x, y: at.y, z: at.z, yaw: at.heading });
  tick(r, 4, {});
  assert.equal(p.checkpoints, 0);
  assert.equal(p.finishTime, null);
  assert.ok(p.s < 0);
});
test("boîtes, turbo, bandes accélératrices et huile fonctionnent en coordonnées 3D", () => {
  const r = fresh(),
    t = getTrack();
  let p = place(r, t.boxes[0].s, t.boxes[0].offset);
  stepRace(r, {}, 1 / 60);
  assert.ok(p.item);
  assert.ok(p.boxTimers[0] > r.clock);
  p.item = "turbo";
  useItem(r, p);
  assert.equal(p.item, null);
  assert.ok(p.boosting > 2);
  p = place(r, t.pads[0].s, t.pads[0].offset);
  p.boosting = 0;
  stepRace(r, {}, 1 / 60);
  assert.ok(p.boosting > 1);
  p = place(r, t.oils[0].s, t.oils[0].offset, 30);
  stepRace(r, {}, 1 / 60);
  assert.ok(p.stun > 1);
  assert.ok(Math.hypot(p.vx, p.vz) < 10);
});
test("la carapace verte part en ligne droite et la banane frappe le poursuivant", () => {
  const r = fresh(),
    p = place(r, 50, 0, 0),
    b = r.players[1];
  p.item = "green";
  useItem(r, p);
  const h = r.hazards[0],
    start = { x: h.x, z: h.z, vx: h.vx, vz: h.vz };
  tick(r, 20, {});
  assert.ok(
    Math.abs((h.x - start.x) * start.vz - (h.z - start.z) * start.vx) < 1e-7,
  );
  r.hazards = [];
  p.item = "banana";
  useItem(r, p);
  const banana = r.hazards[0];
  b.finishTime = null;
  b.bot = false;
  Object.assign(b, {
    x: banana.x,
    y: banana.y - 0.35,
    z: banana.z,
    yaw: p.yaw,
    vx: 0,
    vz: 0,
  });
  stepRace(r, {}, 1 / 60);
  assert.ok(b.stun > 0);
  assert.equal(r.hazards.length, 0);
});
test("la carapace rouge corrige sa trajectoire vers un adversaire et le frappe", () => {
  const r = fresh(),
    t = getTrack(),
    p = place(r, 60, 0, 0),
    b = r.players[1],
    at = t.at(85, 4);
  b.finishTime = null;
  b.bot = false;
  Object.assign(b, {
    x: at.x,
    y: at.y,
    z: at.z,
    yaw: at.heading,
    s: 85,
    vx: 0,
    vz: 0,
  });
  p.item = "red";
  useItem(r, p);
  const initialVz = r.hazards[0].vz;
  stepRace(r, {}, 1 / 60);
  assert.notEqual(r.hazards[0].vz, initialVz);
  tick(r, 48, {});
  assert.ok(b.stun > 0);
  assert.equal(r.hazards.length, 0);
});
for (const t of TRACKS)
  test(`course complète sur ${t.name} : 3 tours, 97 portes et un classement unique`, () => {
    const r = createRace(
      [{ id: "bot-0", name: "Pilote IA", bot: true }],
      42,
      t.id,
    );
    r.phase = "racing";
    for (let i = 0; i < 60 * 285 && r.phase !== "finished"; i++)
      stepRace(r, {}, 1 / 60);
    assert.equal(r.phase, "finished");
    assert.ok(
      r.players.every(
        (p) => p.finishTime !== null && p.lap === LAPS && p.checkpoints >= 97,
      ),
    );
    assert.equal(new Set(r.players.map((p) => p.rank)).size, 4);
  });
