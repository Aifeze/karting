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
async function page() {
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
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
  await a.keyboard.press("Escape");
  assert.ok(await a.locator("#pause-screen").isVisible());
  await a.locator("#resume").click();
  await a.locator("#pause-button").click();
  await a.locator("#quit-race").click();
  await a.locator("#create-room").click();
  await a.waitForSelector("#room-screen:not(.hidden)");
  const code = await a.locator("#display-code").textContent();
  const b = await page();
  await b.locator("#nickname").fill("Mochi");
  await b.locator("#room-code").fill(code);
  await b.locator("#join-form button").click();
  await b.waitForSelector("#room-screen:not(.hidden)");
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
  await a.screenshot({ path: "test-results/multiplayer.png" });
  await a.locator("#pause-button").click();
  await a.locator("#quit-race").click();
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
    "Navigateur : accueil, aide, conduite, pause, salon à deux, départ et mobile validés.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => game.io.close(resolve));
}
