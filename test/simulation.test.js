import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRace,
  stepRace,
  trackAt,
  TRACK_LENGTH,
  BOXES,
  PADS,
  OILS,
  sanitizeInput,
  useItem,
  LAPS,
} from "../public/shared.js";

const fresh = () => {
  const race = createRace([{ id: "human", name: "Toto" }], 42);
  race.phase = "racing";
  return race;
};
const tick = (race, seconds, input = { throttle: 1 }) => {
  for (let i = 0; i < seconds * 60; i++)
    stepRace(race, { human: input }, 1 / 60);
};
test("le circuit est fermé, continu et possède un repère normalisé", () => {
  const a = trackAt(0),
    b = trackAt(TRACK_LENGTH);
  assert.deepEqual(a, b);
  assert.ok(Math.hypot(trackAt(-0.01).x - a.x, trackAt(-0.01).z - a.z) < 0.02);
  assert.ok(TRACK_LENGTH > 600 && TRACK_LENGTH < 1000);
  for (let s = 0; s < TRACK_LENGTH; s += 11) {
    const p = trackAt(s);
    assert.ok(Math.abs(Math.hypot(p.tx, p.tz) - 1) < 1e-10);
    const right = trackAt(s, 5);
    assert.ok(Math.abs(Math.hypot(right.x - p.x, right.z - p.z) - 5) < 1e-8);
  }
});
test("les entrées réseau sont bornées et les messages invalides restent inoffensifs", () => {
  assert.deepEqual(sanitizeInput(null), {
    throttle: 0,
    brake: 0,
    steer: 0,
    drift: false,
    use: false,
  });
  assert.equal(sanitizeInput({ throttle: Infinity, steer: -300 }).throttle, 0);
  assert.equal(
    sanitizeInput({ throttle: { toString: null, valueOf: null } }).throttle,
    0,
  );
  assert.equal(sanitizeInput({ steer: -300 }).steer, -1);
});
test("le départ bloque le kart, puis accélération, freinage et hors-piste fonctionnent", () => {
  const r = createRace([{ id: "human" }], 42),
    p = r.players[0],
    start = p.s;
  tick(r, 2);
  assert.equal(p.s, start);
  assert.equal(p.speed, 0);
  tick(r, 4);
  assert.equal(r.phase, "racing");
  assert.ok(p.speed > 20);
  const speed = p.speed;
  tick(r, 0.5, { brake: 1 });
  assert.ok(p.speed < speed - 8);
  p.offset = 15;
  tick(r, 2);
  assert.ok(p.speed <= 12.1);
});
test("le drift chargé déclenche un mini-turbo au relâchement", () => {
  const r = fresh(),
    p = r.players[0];
  p.s = 60;
  p.speed = 20;
  p.offset = -5;
  // Alterner la direction garde le kart sur la route pendant la charge.
  for (let i = 0; i < 60; i++)
    stepRace(
      r,
      { human: { throttle: 1, drift: true, steer: i % 20 < 10 ? 0.6 : -0.6 } },
      1 / 60,
    );
  assert.ok(p.drift > 0.8);
  stepRace(r, { human: { throttle: 1 } }, 1 / 60);
  assert.ok(p.boosting > 0.8);
  assert.equal(p.drift, 0);
});
test("les boîtes, le turbo, les accélérateurs et les flaques modifient la course", () => {
  const r = fresh(),
    p = r.players[0];
  p.s = BOXES[0].s;
  p.offset = BOXES[0].offset;
  stepRace(r, {}, 1 / 60);
  assert.ok(p.item);
  assert.ok(p.boxTimers[0] > r.clock);
  p.item = "turbo";
  useItem(r, p);
  assert.equal(p.item, null);
  assert.ok(p.boosting > 2);
  p.boosting = 0;
  p.s = PADS[0].s;
  p.offset = PADS[0].offset;
  stepRace(r, {}, 1 / 60);
  assert.ok(p.boosting > 1);
  p.s = OILS[0].s;
  p.offset = OILS[0].offset;
  p.speed = 30;
  stepRace(r, {}, 1 / 60);
  assert.ok(p.stun > 1);
  assert.ok(p.speed < 10);
});
test("la banane et la carapace rouge touchent un adversaire", () => {
  const r = fresh(),
    a = r.players[0],
    b = r.players[1];
  a.s = 100;
  a.offset = 3;
  b.s = 96;
  b.offset = 3;
  b.bot = false;
  a.item = "banana";
  useItem(r, a);
  stepRace(r, {}, 1 / 60);
  assert.ok(b.stun > 0);
  assert.equal(r.hazards.length, 0);
  b.stun = 0;
  a.s = 200;
  b.s = 222;
  a.offset = -2;
  b.offset = 2;
  a.item = "red";
  useItem(r, a);
  tick(r, 0.5, {});
  assert.ok(b.stun > 0, "la carapace poursuit sa cible et la touche");
});
test("une course complète compte trois tours et produit un classement sans doublons", () => {
  const r = fresh(),
    p = r.players[0];
  tick(r, 150);
  assert.ok(p.finishTime > 0 && p.finishTime < 150);
  assert.equal(p.lap, LAPS);
  assert.ok(p.s >= TRACK_LENGTH * LAPS);
  assert.equal(r.phase, "finished");
  assert.equal(new Set(r.players.map((p) => p.rank)).size, r.players.length);
  assert.ok(r.players.every((p) => p.finishTime !== null));
});
