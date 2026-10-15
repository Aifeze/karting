// Micro-benchmark du rendu : même navigateur logiciel, mêmes vues avant/après.
import { chromium } from "playwright";
import { writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createGameServer } from "../server.js";
import assert from "node:assert/strict";
const game = createGameServer();
await new Promise((r) => game.http.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (process.env.KART_BENCH_REF) {
  const source = execFileSync(
    "git",
    ["show", `${process.env.KART_BENCH_REF}:public/world.js`],
    { encoding: "utf8" },
  )
    .replaceAll("./shared.js", "/shared.js")
    .replaceAll("./post.js", "/post.js");
  await page.route("**/world.js", (r) =>
    r.fulfill({ contentType: "application/javascript", body: source }),
  );
}
await page.route("**/app.js", (r) =>
  r.fulfill({ contentType: "application/javascript", body: "" }),
);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${game.http.address().port}`);
  await page.evaluate(async () => {
    const T = await import("/vendor/three.module.js"),
      { World } = await import("/world.js");
    window.perfWorld = new World(T, document.getElementById("world"), {
      quality: "low",
    });
    window.perfWorld.setQuality("low");
    document.getElementById("loading").remove();
  });
  const results = [];
  for (const trackId of ["sunset", "neon", "volcano", "alpine"]) {
    const result = await page.evaluate(async (id) => {
      const w = window.perfWorld,
        { createRace } = await import("/shared.js");
      w.setTrack(id);
      w.setMode("race");
      const race = createRace([{ id: "bench", name: "Benchmark" }], 42, id);
      race.phase = "racing";
      const samples = [];
      let triangles = 0,
        calls = 0;
      for (const fraction of [0.04, 0.38, 0.72]) {
        const p = race.players[0],
          at = w.track.at(w.track.length * fraction);
        Object.assign(p, {
          x: at.x,
          y: at.y,
          z: at.z,
          yaw: at.heading,
          trackS: at.s,
          s: at.s,
          bank: at.bank,
          slope: at.slope,
        });
        w.cameraReady = false;
        let previous = await new Promise(requestAnimationFrame);
        for (let i = 0; i < 16; i++) {
          const now = await new Promise(requestAnimationFrame);
          const duration = now - previous;
          previous = now;
          w.update(race, "bench", { steer: 0 }, 1 / 60, i / 60);
          w.renderer.getContext().finish();
          if (i >= 3) {
            samples.push(duration);
            triangles = Math.max(triangles, w.renderer.info.render.triangles);
            calls = Math.max(calls, w.renderer.info.render.calls);
          }
        }
      }
      samples.sort((a, b) => a - b);
      const size = w.renderer.getDrawingBufferSize(new w.T.Vector2());
      return {
        track: id,
        medianMs: Math.round(samples[Math.floor(samples.length / 2)] * 10) / 10,
        p95Ms: Math.round(samples[Math.floor(samples.length * 0.95)] * 10) / 10,
        triangles,
        calls,
        pixels: size.x * size.y,
        textures: w.renderer.info.memory.textures,
        geometries: w.renderer.info.memory.geometries,
      };
    }, trackId);
    results.push(result);
    console.log(JSON.stringify(result));
    if (!process.env.KART_BENCH_REF) {
      assert.ok(
        result.triangles < 40000,
        `${trackId}: trop de géométrie pour le mode léger`,
      );
      assert.ok(result.calls < 160, `${trackId}: trop d'appels de dessin`);
      assert.ok(result.pixels <= 420000, `${trackId}: résolution trop élevée`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => game.io.close(r));
}
