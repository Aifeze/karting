import {
  createRace,
  stepRace,
  ITEMS,
  COLORS,
  LAPS,
  getTrack,
  clamp,
} from "./shared.js";
import { World, drawMap } from "./world.js";
import { AudioEngine } from "./audio.js";
import { TRACKS } from "./tracks.js";
import { RENDER_VERSION, normalizeQuality } from "./render-settings.js";

const $ = (id) => document.getElementById(id);
const audio = new AudioEngine();
const keys = new Set(),
  touch = new Set();
const pendingActions = new Set();
let world,
  race = null,
  mode = "home",
  myId = "local",
  paused = false,
  online = false,
  room = null,
  resultsShown = false;
let lastTime = performance.now(),
  accumulator = 0,
  lastHud = 0,
  lastSend = 0,
  lastRender = 0,
  lastCountdown = "",
  leaderboardSignature = "",
  toastTimeout,
  messageTimeout;
let selectedColor = COLORS[0];
let selectedTrack = "sunset";
try {
  $("nickname").value = localStorage.getItem("kart-name") || "Pilote";
  selectedColor = COLORS.includes(localStorage.getItem("kart-color"))
    ? localStorage.getItem("kart-color")
    : COLORS[0];
  selectedTrack = getTrack(localStorage.getItem("kart-track")).id;
} catch {
  /* Le stockage privé peut être indisponible. */
}
const socket = window.io ? window.io({ reconnectionAttempts: 5 }) : null;
function toast(text) {
  clearTimeout(toastTimeout);
  $("toast").textContent = text;
  $("toast").classList.remove("hidden");
  toastTimeout = setTimeout(() => $("toast").classList.add("hidden"), 4200);
}
function message(text) {
  clearTimeout(messageTimeout);
  $("race-message").textContent = text;
  $("race-message").classList.add("show");
  messageTimeout = setTimeout(
    () => $("race-message").classList.remove("show"),
    1800,
  );
}
const formatTime = (seconds) => {
  if (seconds == null) return "En piste";
  const ms = Math.max(0, Math.floor(seconds * 1000));
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
const player = () => race?.players.find((p) => p.id === myId);
function profile() {
  const name = $("nickname").value.trim().slice(0, 16) || "Pilote";
  $("nickname").value = name;
  try {
    localStorage.setItem("kart-name", name);
    localStorage.setItem("kart-color", selectedColor);
  } catch {
    /* Facultatif. */
  }
  return { name, color: selectedColor, trackId: selectedTrack };
}
COLORS.slice(0, 5).forEach((color, i) => {
  const b = document.createElement("button");
  b.className = `color-swatch${color === selectedColor ? " selected" : ""}`;
  b.style.setProperty("--swatch", color);
  b.setAttribute(
    "aria-label",
    ["Corail", "Menthe", "Lavande", "Soleil", "Azur"][i],
  );
  b.setAttribute("aria-pressed", color === selectedColor);
  b.addEventListener("click", () => {
    selectedColor = color;
    if (world) world.color = color;
    document.querySelectorAll(".color-swatch").forEach((el) => {
      const selected = el === b;
      el.classList.toggle("selected", selected);
      el.setAttribute("aria-pressed", selected);
    });
  });
  $("colors").append(b);
});
for (const id of ["track-select", "room-track-select"])
  for (const t of TRACKS) {
    const option = document.createElement("option");
    option.value = t.id;
    option.textContent = `${t.number} — ${t.name} · ${Math.round(getTrack(t.id).length)} m`;
    $(id).append(option);
  }
function trackInfo(id) {
  const t = getTrack(id);
  $("track-select").value = id;
  $("track-title").textContent = t.name;
  $("track-index").textContent = `CIRCUIT ${t.number}`;
  $("track-tag").textContent = t.tag;
  $("track-description").textContent = t.description;
  $("track-length").textContent = Math.round(t.length);
  document.querySelector(".track-weather").textContent =
    t.theme === "city"
      ? "☾ 02:00"
      : t.theme === "snow"
        ? "−8 °C"
        : t.theme === "lava"
          ? "54 °C"
          : "☀ 26 °C";
  drawMap($("preview-map"), [], "", false, id);
}
trackInfo(selectedTrack);
$("track-select").addEventListener("change", (e) => {
  selectedTrack = e.target.value;
  trackInfo(selectedTrack);
  world?.setTrack(selectedTrack);
  try {
    localStorage.setItem("kart-track", selectedTrack);
  } catch {
    /* Facultatif. */
  }
});
function qualityChange(value) {
  value = normalizeQuality(value);
  world?.setQuality(value);
  $("quality-select").value = value;
  $("race-quality-select").value = value;
  try {
    localStorage.setItem("kart-quality", value);
    localStorage.setItem("kart-render-version", RENDER_VERSION);
  } catch {
    /* Facultatif. */
  }
}
for (const id of ["quality-select", "race-quality-select"])
  $(id).addEventListener("change", (e) => qualityChange(e.target.value));
$("room-track-select").addEventListener("change", async (e) => {
  try {
    await request("setTrack", { trackId: e.target.value });
  } catch (err) {
    toast(err.message);
    if (room) showRoom(room);
  }
});
for (let i = 0; i < 14; i++)
  $("speed-bars").append(document.createElement("i"));

function begin(newRace, isOnline) {
  pendingActions.clear();
  online = isOnline;
  myId = isOnline ? socket.id : "local";
  race = newRace;
  mode = "race";
  paused = false;
  resultsShown = false;
  accumulator = 0;
  lastCountdown = "";
  leaderboardSignature = "";
  keys.clear();
  touch.clear();
  $("help-dialog").close();
  ["home", "room-screen", "results-screen", "pause-screen"].forEach((id) =>
    $(id).classList.add("hidden"),
  );
  $("hud").classList.remove("hidden");
  document.body.classList.add("racing");
  document.body.dataset.phase = "countdown";
  $("mode-label").textContent = isOnline
    ? `SALON ${room?.code || ""} · EN LIGNE`
    : "COURSE RAPIDE · SOLO";
  $("total-racers").textContent = String(race.players.length).padStart(2, "0");
  $("countdown").textContent = "3";
  world.setTrack(race.trackId);
  const track = getTrack(race.trackId);
  $("race-track-name").textContent = track.name.toUpperCase();
  $("map-track-name").textContent = track.name.toUpperCase();
  $("world").setAttribute("aria-label", `Circuit 3D ${track.name}`);
  world.setMode("race", selectedColor);
  updateHud();
}
function home(leave = true) {
  pendingActions.clear();
  if (leave && socket && online) socket.emit("leaveRoom");
  race = null;
  room = null;
  mode = "home";
  online = false;
  paused = false;
  resultsShown = false;
  keys.clear();
  touch.clear();
  ["hud", "room-screen", "pause-screen", "results-screen"].forEach((id) =>
    $(id).classList.add("hidden"),
  );
  $("home").classList.remove("hidden");
  document.body.classList.remove("racing");
  document.body.dataset.phase = "home";
  world?.setMode("home");
  world?.setTrack(selectedTrack);
  audio.update(null, false);
}
function quickPlay() {
  if (!world) return;
  const p = profile();
  if (socket && room) socket.emit("leaveRoom");
  room = null;
  begin(createRace([{ ...p, id: "local" }], Date.now(), selectedTrack), false);
}
$("quick-play").addEventListener("click", quickPlay);
async function connected() {
  if (!socket)
    throw new Error(
      "Le serveur multijoueur est indisponible. La course rapide reste accessible.",
    );
  if (socket.connected) return;
  await new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };
    const onConnect = () => {
        clean();
        resolve();
      },
      onError = () => {
        clean();
        reject(
          new Error(
            "Connexion au serveur impossible. Réessayez ou lancez une course rapide.",
          ),
        );
      };
    const timeout = setTimeout(onError, 6500);
    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
    socket.connect();
  });
}
async function request(event, data) {
  await connected();
  let result;
  try {
    result =
      data === undefined
        ? await socket.timeout(6500).emitWithAck(event)
        : await socket.timeout(6500).emitWithAck(event, data);
  } catch {
    throw new Error("Le serveur ne répond pas. Réessayez dans un instant.");
  }
  if (result.error) throw new Error(result.error);
  return result;
}
async function busy(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}
$("create-room").addEventListener("click", () =>
  busy($("create-room"), async () => {
    const result = await request("createRoom", profile());
    showRoom(result.room);
  }),
);
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  busy(button, async () => {
    const result = await request("joinRoom", {
      ...profile(),
      code: $("room-code").value.trim().toUpperCase(),
    });
    showRoom(result.room);
  });
});
$("room-code").addEventListener(
  "input",
  (e) =>
    (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "")),
);
const invite = new URLSearchParams(location.search).get("room");
if (invite) {
  $("room-code").value = invite
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 5);
  toast(
    "Le code de votre ami est prêt. Choisissez votre pseudo et rejoignez-le !",
  );
}
function showRoom(data) {
  room = data;
  online = true;
  mode = "room";
  $("home").classList.add("hidden");
  $("room-screen").classList.remove("hidden");
  $("display-code").textContent = room.code;
  const isHost = socket.id === room.host;
  $("room-track-select").value = room.trackId;
  $("room-track-select").disabled = !isHost;
  world?.setTrack(room.trackId);
  $("start-race").disabled = !isHost;
  $("start-race").textContent = isHost
    ? `Lancer la course · ${Math.max(4, room.players.length)} pilotes →`
    : "En attente du départ par l’hôte…";
  $("room-info").textContent =
    room.players.length < 4
      ? `${room.players.length}/8 amis · Les places libres sont complétées par des bots.`
      : `${room.players.length}/8 amis · Tout le monde est prêt ?`;
  $("room-players").replaceChildren();
  for (const p of room.players) {
    const row = document.createElement("div");
    row.className = "room-player";
    const dot = document.createElement("i");
    dot.className = "player-dot";
    dot.style.background = p.color;
    const name = document.createElement("b");
    name.textContent = p.name;
    const tag = document.createElement("small");
    tag.textContent =
      p.id === room.host ? "HÔTE" : p.id === socket.id ? "VOUS" : "PRÊT";
    row.append(dot, name, tag);
    $("room-players").append(row);
  }
}
$("copy-code").addEventListener("click", async () => {
  if (!room) return;
  try {
    await navigator.clipboard.writeText(room.code);
    $("copy-label").textContent = "CODE COPIÉ ✓";
    setTimeout(() => ($("copy-label").textContent = "COPIER LE CODE →"), 2000);
  } catch {
    toast(`Code à partager : ${room.code}`);
  }
});
$("start-race").addEventListener("click", () =>
  busy($("start-race"), () => request("startRace")),
);
$("leave-room").addEventListener("click", () => home());
socket?.on("room", (data) => {
  room = data;
  if (mode === "room") showRoom(data);
});
socket?.on("raceStart", (data) => begin(data, true));
socket?.on("state", (data) => {
  if (!online || mode !== "race") return;
  race = data;
  handleEvents(data.events);
});
socket?.on("backToRoom", (data) => {
  home(false);
  showRoom(data);
});
socket?.on("disconnect", (reason) => {
  console.info("Multijoueur déconnecté :", reason);
  if (online) {
    home(false);
    toast(
      "Connexion perdue. Recréez ou rejoignez un salon ; la course rapide reste disponible.",
    );
  }
});

function getInput() {
  if (mode !== "race" || paused || resultsShown || $("help-dialog").open)
    return { throttle: 0, brake: 0, steer: 0, drift: false, use: false };
  const has = (...codes) => codes.some((c) => keys.has(c));
  let throttle = +(has("ArrowUp", "KeyW", "KeyZ") || touch.has("gas")),
    brake = +(has("ArrowDown", "KeyS") || touch.has("brake"));
  let steer =
    +(has("ArrowRight", "KeyD") || touch.has("right")) -
    +(has("ArrowLeft", "KeyA", "KeyQ") || touch.has("left"));
  let drift = has("ShiftLeft", "ShiftRight") || touch.has("drift"),
    use = has("Space") || touch.has("use");
  const pad = navigator.getGamepads?.().find((p) => p?.connected);
  if (pad) {
    const axis = pad.axes[0] || 0;
    if (Math.abs(axis) > 0.12)
      steer = ((Math.abs(axis) - 0.12) / 0.88) * Math.sign(axis);
    throttle = Math.max(
      throttle,
      pad.buttons[7]?.value || 0,
      pad.buttons[0]?.pressed ? 1 : 0,
    );
    brake = Math.max(brake, pad.buttons[6]?.value || 0);
    drift ||= !!pad.buttons[1]?.pressed;
    use ||= !!pad.buttons[2]?.pressed;
  }
  return {
    throttle,
    brake,
    steer: clamp(steer, -1, 1),
    drift,
    use,
    reset: has("KeyR") || touch.has("reset") || !!pad?.buttons[3]?.pressed,
  };
}
function setPaused(value) {
  if (mode !== "race" || resultsShown) return;
  paused = value;
  pendingActions.clear();
  keys.clear();
  touch.clear();
  $("pause-screen").classList.toggle("hidden", !value);
  $("pause-info").textContent = online
    ? "Le salon reste en course pendant votre arrêt. Revenez vite !"
    : "Votre kart vous attend. Le podium aussi.";
  audio.update(player(), !paused);
}
$("pause-button").addEventListener("click", () => setPaused(true));
$("resume").addEventListener("click", () => setPaused(false));
$("quit-race").addEventListener("click", () => home());
function showHelp() {
  keys.clear();
  if (mode === "race") setPaused(true);
  $("help-dialog").showModal();
}
$("help-button").addEventListener("click", showHelp);
$("close-help").addEventListener("click", () => $("help-dialog").close());
$("help-dialog").addEventListener("click", (e) => {
  if (
    e.target === $("help-dialog") &&
    (e.offsetX < 0 ||
      e.offsetY < 0 ||
      e.offsetX > e.target.offsetWidth ||
      e.offsetY > e.target.offsetHeight)
  )
    e.target.close();
});
async function soundToggle() {
  const enabled = await audio.toggle();
  $("sound-label").textContent = enabled ? "SON ON" : "SON OFF";
  $("sound-icon").textContent = enabled ? "♫" : "◌";
  $("sound-button").setAttribute(
    "aria-label",
    enabled ? "Couper le son" : "Activer le son",
  );
}
$("sound-button").addEventListener("click", soundToggle);
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (
    !e.repeat &&
    mode === "race" &&
    !paused &&
    race?.phase === "racing" &&
    !resultsShown &&
    !$("help-dialog").open
  ) {
    if (e.code === "Space") pendingActions.add("use");
    if (e.code === "KeyR") pendingActions.add("reset");
  }
  if (
    mode === "race" &&
    [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
    ].includes(e.code)
  ) {
    if (e.code !== "Tab") e.preventDefault();
  }
  if (!e.repeat && e.code === "KeyM") soundToggle();
  if (!e.repeat && e.code === "KeyH" && !$("help-dialog").open) showHelp();
  if (
    !e.repeat &&
    (e.code === "Escape" || e.code === "KeyP") &&
    !$("help-dialog").open
  )
    setPaused(!paused);
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  touch.clear();
  if (mode === "race") setPaused(true);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    touch.clear();
    if (mode === "race") setPaused(true);
  }
});
document.querySelectorAll("[data-control]").forEach((button) => {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touch.add(button.dataset.control);
    if (["use", "reset"].includes(button.dataset.control))
      pendingActions.add(button.dataset.control);
    button.classList.add("pressed");
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(name, () => {
      touch.delete(button.dataset.control);
      button.classList.remove("pressed");
    });
});
function handleEvents(events = []) {
  for (const e of events)
    if (e.player === myId) {
      audio.effect(e.type);
      if (e.type === "pickup")
        message(`${ITEMS[e.kind].label.toUpperCase()} EN POCHE !`);
      if (e.type === "hit") message("ÇA SE RÈGLE AU PROCHAIN VIRAGE.");
      if (e.type === "driftBoost") message("BEAU DRIFT. PLACE AU TURBO !");
      if (e.type === "lap")
        message(
          e.lap === LAPS
            ? "DERNIER TOUR. TOUT DONNER !"
            : `TOUR ${e.lap} / ${LAPS}`,
        );
    }
}
function updateHud() {
  const p = player();
  if (!p) return;
  $("speed").textContent = Math.round(p.speed * 3.6);
  $("gear").textContent =
    p.forwardSpeed < -1
      ? "R"
      : p.speed < 1
        ? "N"
        : Math.min(6, Math.floor(p.speed / 7) + 1);
  $("position").textContent = String(p.rank).padStart(2, "0");
  $("lap").replaceChildren(document.createTextNode(`${p.lap} `));
  const lapTotal = document.createElement("i");
  lapTotal.textContent = `/ ${LAPS}`;
  $("lap").append(lapTotal);
  $("timer").textContent = formatTime(p.finishTime ?? race.elapsed);
  const track = getTrack(race.trackId);
  $("respawn-overlay").classList.toggle("hidden", !p.falling);
  $("respawn-timer").textContent = `${Math.max(
    0,
    (p.respawnAt || 0) - race.clock,
  )
    .toFixed(1)
    .replace(".", ",")} s`;
  $("hud").dataset.falling = p.falling;
  $("hud").dataset.respawns = p.respawns;
  $("wrong-way").classList.toggle("hidden", !p.wrongWay || p.falling);
  $("drive-status").textContent = p.falling
    ? "CHUTE · RAPPEL EN COURS"
    : p.stun > 0
      ? "TÊTE À QUEUE"
      : Math.abs(p.offset) > track.halfWidth
        ? "HORS-PISTE"
        : p.boosting > 0
          ? "TURBO ENGAGÉ ϟ"
          : p.drift > 0.2
            ? "CHARGE DU DRIFT"
            : p.speed > 2
              ? "PLEIN GAZ, LES AMIS."
              : "ACCÉLÉREZ AVEC ↑ OU Z";
  [...$("speed-bars").children].forEach((bar, i) =>
    bar.classList.toggle("active", i < (p.speed / 52) * 14),
  );
  $("drift-charge").style.width = `${(p.drift / 3) * 100}%`;
  $("drift-charge").style.background = p.drift > 1.8 ? "#7febef" : "#ffb64b";
  $("boost-fx").classList.toggle("on", p.boosting > 0);
  const item = ITEMS[p.item];
  $("item-icon").textContent = item?.icon || "?";
  $("item-icon").classList.toggle("loaded", !!item);
  if (item) $("item-icon").style.setProperty("--item-color", item.color);
  $("item-name").textContent = item?.label || "Trouvez une boîte !";
  const sorted = [...race.players].sort((a, b) => a.rank - b.rank);
  const sig = sorted.map((p) => p.id + p.rank).join();
  if (sig !== leaderboardSignature) {
    leaderboardSignature = sig;
    $("leaderboard").replaceChildren();
    for (const racer of sorted.slice(0, 8)) {
      const row = document.createElement("div");
      row.className = `leader-row${racer.id === myId ? " me" : ""}`;
      const rank = document.createElement("small");
      rank.textContent = racer.rank;
      const dot = document.createElement("i");
      dot.className = "player-dot";
      dot.style.background = racer.color;
      const name = document.createElement("span");
      name.textContent =
        racer.id === myId ? `${racer.name} · vous` : racer.name;
      row.append(rank, dot, name);
      $("leaderboard").append(row);
    }
  }
  drawMap($("minimap"), race.players, myId, true, race.trackId);
  const count =
    race.phase === "countdown"
      ? String(Math.max(1, Math.ceil(race.countdown)))
      : race.elapsed < 0.85
        ? "GO !"
        : "";
  if (count !== lastCountdown) {
    $("countdown").textContent = count;
    if (count) audio.note(count === "GO !" ? 880 : 440, 0.15, "square");
    lastCountdown = count;
  }
  document.body.dataset.phase = race.phase;
  if ((p.finishTime !== null || race.phase === "finished") && !resultsShown) {
    resultsShown = true;
    paused = false;
    keys.clear();
    $("pause-screen").classList.add("hidden");
    $("results-screen").classList.remove("hidden");
    $("results-title").textContent =
      p.rank === 1 ? "Le podium est à vous." : "La revanche sera belle.";
    $("results-subtitle").textContent =
      p.finishTime !== null
        ? `${p.rank}${p.rank === 1 ? "er" : "e"} sur ${race.players.length} pilotes · ${formatTime(p.finishTime)}`
        : "Temps limite atteint. Classement à la distance parcourue.";
  }
  if (resultsShown) renderResults(sorted);
}
function renderResults(sorted) {
  $("results-list").replaceChildren();
  for (const p of sorted) {
    const row = document.createElement("div");
    row.className = `result-row${p.id === myId ? " me" : ""}`;
    const rank = document.createElement("b");
    rank.textContent = String(p.rank).padStart(2, "0");
    const dot = document.createElement("i");
    dot.className = "player-dot";
    dot.style.background = p.color;
    const name = document.createElement("strong");
    name.textContent = p.name;
    const time = document.createElement("small");
    time.textContent = formatTime(p.finishTime);
    row.append(rank, dot, name, time);
    $("results-list").append(row);
  }
  const button = $("play-again");
  if (!online) {
    button.disabled = false;
    button.textContent = "Encore une course ? →";
  } else if (room?.host !== socket.id) {
    button.disabled = true;
    button.textContent = "L’hôte prépare la revanche…";
  } else {
    const waiting =
      race.phase !== "finished" &&
      race.players.some((p) => !p.bot && p.finishTime === null);
    button.disabled = waiting;
    button.textContent = waiting
      ? "Les amis terminent leur course…"
      : "Retour au salon · La revanche →";
  }
}
$("play-again").addEventListener("click", () => {
  if (online) busy($("play-again"), () => request("resetRoom"));
  else quickPlay();
});
$("results-home").addEventListener("click", () => home());

async function init() {
  try {
    // CDN en priorité ; la copie npm permet de jouer si son réseau filtre le CDN.
    let THREE;
    try {
      THREE = await Promise.race([
        import(
          "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js"
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("CDN timeout")), 2500),
        ),
      ]);
    } catch {
      THREE = await import("/vendor/three.module.js");
    }
    let quality = "low";
    try {
      // L'ancien réglage ne réduisait pas la scène. Démarrer la nouvelle
      // version en mode léger, puis mémoriser les choix explicites du joueur.
      if (localStorage.getItem("kart-render-version") === RENDER_VERSION)
        quality = normalizeQuality(localStorage.getItem("kart-quality"));
    } catch {
      /* Facultatif. */
    }
    world = new World(THREE, $("world"), { quality, trackId: selectedTrack });
    world.color = selectedColor;
    qualityChange(quality);
    document.body.dataset.webgl = "ready";
    document.body.dataset.phase = "home";
    $("loading").style.opacity = "0";
    setTimeout(() => $("loading").classList.add("hidden"), 450);
    requestAnimationFrame(frame);
  } catch (error) {
    console.error("Initialisation 3D :", error);
    $("loading").replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "La 3D ne peut pas démarrer.";
    const desc = document.createElement("small");
    desc.textContent =
      "Activez WebGL et l’accélération graphique, puis rechargez la page.";
    const reload = document.createElement("button");
    reload.className = "button button-primary";
    reload.style.width = "240px";
    reload.textContent = "Réessayer →";
    reload.onclick = () => location.reload();
    $("loading").append(title, desc, reload);
  }
}
function frame(now) {
  const elapsed = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  const input = getInput();
  if (!document.hidden && mode === "race" && !paused && !resultsShown)
    world.noteFrame(elapsed, now);
  if (mode === "race" && race) {
    if (!online && !paused && !$("help-dialog").open) {
      // Le rendu peut ralentir ; le temps de course et le rappel de 2,5 s
      // restent en secondes réelles. Les intégrations gardent un pas de 1/60 s.
      accumulator += elapsed;
      while (accumulator >= 1 / 60) {
        const lastStep = accumulator < 2 / 60;
        const applied = { ...input };
        for (const action of pendingActions) applied[action] = lastStep;
        stepRace(race, { [myId]: applied }, 1 / 60);
        handleEvents(race.events);
        accumulator -= 1 / 60;
        if (lastStep) pendingActions.clear();
      }
    }
    if (online && now - lastSend > 1000 / 30) {
      socket.emit("input", {
        ...input,
        ...Object.fromEntries(
          [...pendingActions].map((action) => [action, true]),
        ),
      });
      pendingActions.clear();
      lastSend = now;
    }
    if (now - lastHud > 75) {
      updateHud();
      lastHud = now;
    }
    audio.update(player(), !paused && !resultsShown && race.phase === "racing");
  }
  // Les salons et onglets cachés ne doivent pas monopoliser le GPU ; le réseau
  // et la simulation continuent indépendamment du rendu.
  const renderInterval = mode === "race" && !paused ? 0 : 1000 / 24;
  if (!document.hidden && now - lastRender >= renderInterval) {
    world.update(
      race,
      myId,
      input,
      Math.min((now - lastRender) / 1000, 0.1),
      now / 1000,
    );
    lastRender = now;
  }
  requestAnimationFrame(frame);
}
init();
