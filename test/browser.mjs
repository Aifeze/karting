import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { createGameServer } from "../server.js";

const game = createGameServer();
await new Promise((resolve) => game.http.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${game.http.address().port}`;
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});
mkdirSync("test-results", { recursive: true });
const errors = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
// Vérifie aussi le repli CDN, utile en environnement isolé.
await context.route("**/cdn.jsdelivr.net/**", (route) => route.abort());
async function page(viewport) {
  const p = await context.newPage();
  if (viewport) await p.setViewportSize(viewport);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (
      m.type() === "error" &&
      /WebGLProgram|VALIDATE_STATUS|INVALID_OPERATION/.test(m.text())
    )
      errors.push(m.text());
  });
  await p.goto(url);
  await p.waitForSelector('body[data-webgl="ready"]');
  await p.waitForSelector("#loading.hidden", { state: "attached" });
  return p;
}
try {
  const a = await page();
  assert.ok(
    await a
      .locator(".play-card")
      .evaluate((el) => el.getBoundingClientRect().bottom < innerHeight - 30),
    "le formulaire entier reste dans la fenêtre",
  );
  await a.screenshot({ path: "test-results/home.png" });
  assert.equal(await a.getAttribute("body", "data-quality"), "low");
  assert.ok(
    await a.locator("#world").evaluate((c) => c.width * c.height <= 420000),
    "résolution plafonnée dès le premier affichage",
  );
  await a.locator("#quality-select").selectOption("balanced");
  for (const id of ["neon", "volcano", "alpine"]) {
    await a.locator("#track-select").selectOption(id);
    await a.waitForSelector(`body[data-track="${id}"]`);
    await a.screenshot({ path: `test-results/track-${id}.png` });
  }
  await a.locator("#quality-select").selectOption("low");
  await a.setViewportSize({ width: 3840, height: 2160 });
  assert.ok(
    await a.locator("#world").evaluate((c) => c.width * c.height <= 420000),
    "un écran 4K ne doit pas forcer un rendu 4K en léger",
  );
  await a.setViewportSize({ width: 1100, height: 760 });
  await a.getByRole("button", { name: "Afficher les commandes" }).click();
  assert.ok(await a.locator("#help-dialog").isVisible());
  await a.getByRole("button", { name: "Fermer", exact: true }).click();
  await a.locator("#nickname").fill("TurboToto");
  await a.locator("#quick-play").click();
  await a.waitForSelector('body[data-phase="racing"]');
  await a.keyboard.down("ArrowUp");
  await a.waitForFunction(
    () => Number(document.getElementById("speed").textContent) > 35,
  );
  await a.keyboard.up("ArrowUp");
  await a.screenshot({ path: "test-results/cockpit.png" });
  await a.keyboard.press("KeyR");
  await a.waitForSelector("#respawn-overlay:not(.hidden)");
  await a.waitForSelector('#hud[data-respawns="1"]');
  assert.equal(await a.locator("#respawn-overlay").isVisible(), false);
  await a.keyboard.press("Escape");
  assert.ok(await a.locator("#pause-screen").isVisible());
  await a.locator("#race-quality-select").selectOption("balanced");
  await a.locator("#race-quality-select").selectOption("low");
  assert.equal(await a.getAttribute("body", "data-quality"), "low");
  await a.locator("#resume").click();
  await a.locator("#pause-button").click();
  await a.locator("#quit-race").click();
  await a.locator("#create-room").click();
  await a.waitForSelector("#room-screen:not(.hidden)");
  const code = await a.locator("#display-code").textContent();
  await a.locator("#room-track-select").selectOption("neon");
  await a.waitForSelector('body[data-track="neon"]');
  const b = await page({ width: 960, height: 720 });
  await b.locator("#nickname").fill("Mochi");
  await b.locator("#room-code").fill(code);
  await b.locator("#join-form button").click();
  await b.waitForSelector("#room-screen:not(.hidden)");
  assert.equal(await b.locator("#room-track-select").inputValue(), "neon");
  assert.equal(await b.locator("#room-track-select").isDisabled(), true);
  await b.locator("#quality-select").selectOption("low");
  await a.waitForFunction(
    () => document.querySelectorAll(".room-player").length === 2,
  );
  await a.bringToFront();
  await a.locator("#start-race").click();
  await Promise.all([
    a.waitForSelector("#hud:not(.hidden)"),
    b.waitForSelector("#hud:not(.hidden)"),
  ]);
  assert.match(await b.locator("#mode-label").textContent(), new RegExp(code));
  assert.equal(await b.getAttribute("body", "data-track"), "neon");
  await a.screenshot({ path: "test-results/multiplayer.png" });
  await a.locator("#pause-button").click();
  await a.locator("#quit-race").click();
  // Le mobile représente un troisième appareil, pas un troisième renderer
  // concurrent sur le même GPU logiciel de CI.
  await context.close();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.route("**/cdn.jsdelivr.net/**", (route) => route.abort());
  const m = await mobile.newPage();
  m.on("pageerror", (e) => errors.push(e.message));
  await m.goto(url);
  await m.waitForSelector("#loading.hidden", { state: "attached" });
  assert.equal(
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  assert.ok(
    await m
      .locator(".play-card")
      .evaluate((el) => el.getBoundingClientRect().bottom < innerHeight - 20),
    "le formulaire mobile reste visible",
  );
  await m.screenshot({ path: "test-results/mobile.png" });
  await m.locator("#quick-play").click();
  assert.ok(await m.locator(".touch-controls").isVisible());
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log(
    "Navigateur : quatre environnements HDR, conduite, rappel, pause, circuit synchronisé à deux joueurs et mobile validés.",
  );
} catch (error) {
  for (const [index, p] of browser
    .contexts()
    .flatMap((c) => c.pages())
    .entries()) {
    console.log(
      "Diagnostic navigateur",
      index,
      await p
        .evaluate(() => ({
          phase: document.body.dataset.phase,
          track: document.body.dataset.track,
          toast: document.getElementById("toast").textContent,
          hudHidden: document
            .getElementById("hud")
            .classList.contains("hidden"),
        }))
        .catch(() => "page fermée"),
    );
    await p
      .screenshot({ path: `test-results/failure-${index}.png`, timeout: 5000 })
      .catch(() => {});
  }
  console.log("Erreurs JavaScript/WebGL", errors);
  console.log(
    "Salons actifs",
    [...game.rooms.values()].map((r) => ({
      code: r.code,
      players: r.players.size,
      racing: !!r.race,
    })),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => game.io.close(resolve));
}
