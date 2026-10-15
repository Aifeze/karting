import express from "express";
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Server } from "socket.io";
import {
  createRace,
  stepRace,
  snapshot,
  sanitizeInput,
  COLORS,
} from "./public/shared.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function createGameServer() {
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { maxHttpBufferSize: 4096, pingTimeout: 15000 });
  const rooms = new Map();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({ status: "ok", rooms: rooms.size }),
  );
  // Repli local si le CDN est indisponible ; aucune étape de compilation.
  app.get("/vendor/three.module.js", (_req, res) =>
    res.sendFile(path.join(root, "node_modules/three/build/three.module.js")),
  );
  app.get("/vendor/three.core.js", (_req, res) =>
    res.sendFile(path.join(root, "node_modules/three/build/three.core.js")),
  );
  app.use(express.static(path.join(root, "public")));
  const publicRoom = (room) => ({
    code: room.code,
    host: room.host,
    racing: !!room.race,
    players: [...room.players.values()],
  });
  const announce = (room) => io.to(room.code).emit("room", publicRoom(room));
  function leave(socket) {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    socket.leave(room.code);
    room.players.delete(socket.id);
    delete room.inputs[socket.id];
    if (room.race) {
      const p = room.race.players.find((p) => p.id === socket.id);
      if (p) p.bot = true;
    }
    socket.data.room = null;
    if (!room.players.size) rooms.delete(room.code);
    else {
      if (room.host === socket.id) room.host = room.players.keys().next().value;
      announce(room);
    }
  }
  io.on("connection", (socket) => {
    let lastRoomAction = 0;
    const profile = (data) => ({
      id: socket.id,
      name:
        (typeof data?.name === "string" ? data.name : "Pilote")
          .replace(/[\u0000-\u001f<>]/g, "")
          .trim()
          .slice(0, 16) || "Pilote",
      color: COLORS.includes(data?.color) ? data.color : COLORS[0],
    });
    socket.on("createRoom", (data, reply = () => {}) => {
      if (typeof reply !== "function") return;
      if (Date.now() - lastRoomAction < 700)
        return reply({ error: "Un instant avant de créer un autre salon." });
      lastRoomAction = Date.now();
      if (rooms.size >= 100)
        return reply({
          error: "Tous les stands sont occupés. Réessayez dans un instant.",
        });
      leave(socket);
      let code;
      do {
        code = Array.from(
          { length: 5 },
          () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
        ).join("");
      } while (rooms.has(code));
      const room = {
        code,
        host: socket.id,
        players: new Map([[socket.id, profile(data)]]),
        inputs: {},
        race: null,
      };
      rooms.set(code, room);
      socket.data.room = code;
      socket.join(code);
      reply({ room: publicRoom(room) });
      announce(room);
    });
    socket.on("joinRoom", (data, reply = () => {}) => {
      if (typeof reply !== "function") return;
      const code =
        typeof data?.code === "string" ? data.code.toUpperCase().trim() : "";
      const room = rooms.get(code);
      if (!room)
        return reply({
          error: "Salon introuvable. Vérifiez le code de votre ami.",
        });
      if (room.race)
        return reply({
          error: "La course a déjà commencé. Rejoignez un nouveau salon.",
        });
      if (room.players.size >= 8 && !room.players.has(socket.id))
        return reply({ error: "Le salon est complet (8 pilotes)." });
      if (socket.data.room !== code) leave(socket);
      room.players.set(socket.id, profile(data));
      socket.data.room = code;
      socket.join(code);
      reply({ room: publicRoom(room) });
      announce(room);
    });
    socket.on("startRace", (reply = () => {}) => {
      if (typeof reply !== "function") return;
      const room = rooms.get(socket.data.room);
      if (!room || room.host !== socket.id)
        return reply({ error: "Seul l’hôte peut lancer le départ." });
      if (room.race) return reply({ error: "La course est déjà lancée." });
      room.race = createRace([...room.players.values()]);
      room.inputs = {};
      io.to(room.code).emit("raceStart", snapshot(room.race));
      reply({ ok: true });
    });
    socket.on("input", (data) => {
      const room = rooms.get(socket.data.room);
      if (room?.race && room.players.has(socket.id))
        room.inputs[socket.id] = {
          ...sanitizeInput(data),
          receivedAt: Date.now(),
        };
    });
    socket.on("resetRoom", (reply = () => {}) => {
      if (typeof reply !== "function") return;
      const room = rooms.get(socket.data.room);
      if (!room || room.host !== socket.id)
        return reply({ error: "Seul l’hôte peut préparer la revanche." });
      if (
        room.race &&
        room.race.phase !== "finished" &&
        room.race.players.some((p) => !p.bot && p.finishTime === null)
      )
        return reply({
          error: "Les autres pilotes terminent encore leur course.",
        });
      room.race = null;
      room.inputs = {};
      io.to(room.code).emit("backToRoom", publicRoom(room));
      reply({ ok: true });
    });
    socket.on("leaveRoom", () => leave(socket));
    socket.on("disconnect", () => leave(socket));
  });
  const tick = setInterval(() => {
    for (const room of rooms.values())
      if (room.race) {
        for (const [id, input] of Object.entries(room.inputs))
          if (Date.now() - input.receivedAt > 750) delete room.inputs[id];
        stepRace(room.race, room.inputs, 1 / 30);
        io.to(room.code).emit("state", snapshot(room.race));
      }
  }, 1000 / 30);
  tick.unref();
  http.on("close", () => clearInterval(tick));
  return { app, http, io, rooms };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { http } = createGameServer();
  http.listen(Number(process.env.PORT) || 3000, "0.0.0.0", () =>
    console.log(
      `Kart Club prêt sur le port ${Number(process.env.PORT) || 3000}`,
    ),
  );
}
