import { test } from "node:test";
import assert from "node:assert/strict";
import { io as client } from "socket.io-client";
import { createGameServer } from "../server.js";

function until(socket, event, predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout: ${event}`));
    }, timeout);
    const handler = (data) => {
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    };
    socket.on(event, handler);
  });
}
test(
  "deux amis rejoignent un salon, courent et récupèrent un hôte après une déconnexion",
  { timeout: 15000 },
  async () => {
    const game = createGameServer();
    await new Promise((resolve) => game.http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${game.http.address().port}`;
    const a = client(url, { transports: ["websocket"] }),
      b = client(url, { transports: ["websocket"] });
    let inputTimer;
    try {
      await Promise.all([
        new Promise((resolve) => a.on("connect", resolve)),
        new Promise((resolve) => b.on("connect", resolve)),
      ]);
      const health = await fetch(url + "/health").then((r) => r.json());
      assert.equal(health.status, "ok");
      assert.ok(
        (await b.emitWithAck("joinRoom", { code: { toString: null } })).error,
      );
      const { room } = await a.emitWithAck("createRoom", {
        name: "<Turbo>",
        color: "#ff7045",
      });
      assert.match(room.code, /^[A-Z2-9]{5}$/);
      assert.equal(room.players[0].name, "Turbo");
      const joined = await b.emitWithAck("joinRoom", {
        code: room.code,
        name: "Banane",
      });
      assert.equal(joined.room.players.length, 2);
      assert.ok((await b.emitWithAck("setTrack", { trackId: "neon" })).error);
      assert.ok(
        (await a.emitWithAck("setTrack", { trackId: "unknown" })).error,
      );
      const selected = until(b, "room", (data) => data.trackId === "neon");
      assert.equal(
        (await a.emitWithAck("setTrack", { trackId: "neon" })).ok,
        true,
      );
      assert.equal((await selected).trackId, "neon");
      assert.ok((await b.emitWithAck("startRace")).error);
      const startB = until(b, "raceStart", () => true);
      assert.equal((await a.emitWithAck("startRace")).ok, true);
      const initial = await startB;
      assert.equal(initial.players.length, 4);
      assert.equal(initial.trackId, "neon");
      assert.ok((await b.emitWithAck("joinRoom", { code: room.code })).error);
      await until(a, "state", (r) => r.phase === "racing");
      a.emit("input", null); // Aucune exception du serveur sur un message malformé.
      inputTimer = setInterval(() => {
        a.emit("input", { throttle: 1 });
        b.emit("input", { throttle: 1, steer: 0.2 });
      }, 30);
      const state = await until(
        a,
        "state",
        (r) =>
          r.players.find((p) => p.id === a.id).speed > 7 &&
          r.players.find((p) => p.id === b.id).speed > 7,
      );
      clearInterval(inputTimer);
      assert.ok(
        state.players.find((p) => p.id === a.id).s >
          initial.players.find((p) => p.id === a.id).s + 0.5,
      );
      a.emit("input", { reset: true });
      const fall = await until(
        a,
        "state",
        (r) => r.players.find((p) => p.id === a.id).falling,
      );
      const startTime = performance.now();
      const returned = await until(
        a,
        "state",
        (r) => r.players.find((p) => p.id === a.id).respawns === 1,
      );
      assert.ok(
        Math.abs((performance.now() - startTime) / 1000 - 2.5) < 0.12,
        "le délai réseau suit les secondes réelles",
      );
      assert.ok(Math.abs(returned.clock - fall.clock - 2.5) < 1e-8);
      assert.ok(returned.players.find((p) => p.id === a.id).invulnerable > 0);
      const oldA = a.id,
        hostChange = until(b, "room", (r) => r.host === b.id);
      a.disconnect();
      assert.equal((await hostChange).host, b.id);
      const next = await until(
        b,
        "state",
        (r) => r.players.find((p) => p.id === oldA).bot,
      );
      assert.ok(next.players.find((p) => p.id === oldA).bot);
      b.emit("leaveRoom");
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(game.rooms.size, 0);
    } finally {
      clearInterval(inputTimer);
      a.disconnect();
      b.disconnect();
      await new Promise((resolve) => game.io.close(resolve));
    }
  },
);
