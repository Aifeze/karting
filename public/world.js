import {
  trackAt,
  TRACK_LENGTH,
  TRACK_WIDTH,
  BOXES,
  PADS,
  OILS,
  COLORS,
  clamp,
  TAU,
} from "./shared.js";

export class World {
  constructor(T, canvas) {
    this.T = T;
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, innerWidth < 600 ? 1.25 : 1.75),
    );
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene = new T.Scene();
    this.scene.background = new T.Color("#c9e5ed");
    this.scene.fog = new T.Fog("#c9e5ed", 110, 470);
    this.camera = new T.PerspectiveCamera(
      65,
      innerWidth / innerHeight,
      0.05,
      900,
    );
    this.scene.add(this.camera);
    this.scene.add(new T.HemisphereLight("#fff5dd", "#91b6aa", 1.5));
    const sun = new T.DirectionalLight("#fff3dc", 2.3);
    sun.position.set(-70, 140, 90);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, {
      left: -190,
      right: 190,
      top: 190,
      bottom: -190,
      near: 1,
      far: 400,
    });
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun);
    this.materials = new Map();
    this.karts = new Map();
    this.hazardMeshes = new Map();
    this.crates = [];
    this.cameraReady = false;
    this.mode = "home";
    this.time = 0;
    this.particles = [];
    this.buildIsland();
    this.buildTrack();
    this.buildScenery();
    this.buildCockpit();
    this.buildParticles();
    window.addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }
  mat(color, options = {}) {
    const key = color + JSON.stringify(options);
    if (!this.materials.has(key))
      this.materials.set(
        key,
        new this.T.MeshStandardMaterial({ color, roughness: 0.78, ...options }),
      );
    return this.materials.get(key);
  }
  mesh(geo, material, x = 0, y = 0, z = 0, parent = this.scene) {
    const mesh = new this.T.Mesh(geo, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  box(w, h, d, color, x = 0, y = 0, z = 0, parent) {
    return this.mesh(
      new this.T.BoxGeometry(w, h, d),
      this.mat(color),
      x,
      y,
      z,
      parent,
    );
  }
  texture(draw, width = 256, height = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext("2d"), width, height);
    const tex = new this.T.CanvasTexture(canvas);
    tex.colorSpace = this.T.SRGBColorSpace;
    return tex;
  }
  instances(geo, material, transforms) {
    const mesh = new this.T.InstancedMesh(geo, material, transforms.length),
      dummy = new this.T.Object3D();
    transforms.forEach((t, i) => {
      dummy.position.set(...t.p);
      dummy.rotation.set(...(t.r || [0, 0, 0]));
      dummy.scale.set(...(t.s || [1, 1, 1]));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (t.c) mesh.setColorAt(i, new this.T.Color(t.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    return mesh;
  }
  buildIsland() {
    const T = this.T;
    this.mesh(
      new T.PlaneGeometry(2400, 2400),
      this.mat("#75c9d4", { roughness: 0.3 }),
      0,
      -15,
      0,
    ).rotation.x = -Math.PI / 2;
    this.mesh(
      new T.CylinderGeometry(208, 215, 6, 80),
      this.mat("#f0d5a1"),
      0,
      -12,
      0,
    );
    this.mesh(
      new T.CylinderGeometry(198, 207, 4, 80),
      this.mat("#9fc898"),
      0,
      -7.5,
      0,
    ).receiveShadow = true;
    const mountains = [
      { x: -100, z: -230, r: 65, h: 80, c: "#b2a6cb" },
      { x: -195, z: -180, r: 65, h: 65, c: "#c0b0d5" },
      { x: -14, z: -270, r: 68, h: 98, c: "#c1b7d2" },
      { x: 160, z: -220, r: 80, h: 95, c: "#c3bdd1" },
    ];
    for (const m of mountains)
      this.mesh(
        new T.ConeGeometry(m.r, m.h, 5),
        this.mat(m.c),
        m.x,
        m.h / 2 - 16,
        m.z,
      ).rotation.y = 0.5;
    this.mesh(
      new T.SphereGeometry(23, 32, 16),
      new T.MeshBasicMaterial({ color: "#ffe9b2", fog: false }),
      -190,
      109,
      -305,
    );
    const clouds = [];
    for (let i = 0; i < 14; i++) {
      const angle = i * 2.4;
      for (let j = 0; j < 4; j++)
        clouds.push({
          p: [
            Math.sin(angle) * 300 + j * 10,
            62 + (i % 4) * 16 + Math.sin(j) * 5,
            Math.cos(angle) * 300,
          ],
          s: [14, 6 + (j % 2) * 3, 8],
        });
    }
    this.instances(new T.SphereGeometry(1, 10, 6), this.mat("#fff9ed"), clouds);
  }
  ribbon(from, to, color, alternate = false) {
    const T = this.T,
      vertices = [],
      colors = [],
      indices = [];
    for (let i = 0; i < 640; i++) {
      const a = (i / 640) * TRACK_LENGTH,
        b = ((i + 1) / 640) * TRACK_LENGTH;
      for (const [s, o] of [
        [a, from],
        [a, to],
        [b, from],
        [b, to],
      ]) {
        const p = trackAt(s, o);
        vertices.push(p.x, p.y + 0.02, p.z);
      }
      const c = new T.Color(
        alternate && Math.floor(i / 5) % 2 ? "#fff5e7" : color,
      );
      for (let j = 0; j < 4; j++) colors.push(c.r, c.g, c.b);
      const k = i * 4;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = this.mesh(
      geo,
      this.mat("#ffffff", { vertexColors: true, side: T.DoubleSide }),
    );
    mesh.receiveShadow = true;
    return mesh;
  }
  buildTrack() {
    const T = this.T;
    this.ribbon(-12.7, -9.8, "#aeb889");
    this.ribbon(9.8, 12.7, "#aeb889");
    this.ribbon(-9.1, 9.1, "#656b80");
    this.ribbon(-9.8, -9.1, "#ff855e", true);
    this.ribbon(9.1, 9.8, "#ff855e", true);
    const dashes = [],
      edges = [],
      barriers = [],
      supports = [];
    for (let s = 0; s < TRACK_LENGTH; s += 10) {
      const p = trackAt(s);
      dashes.push({
        p: [p.x, p.y + 0.065, p.z],
        r: [0, p.heading, p.bank],
        s: [0.15, 0.025, 3.8],
      });
      for (const o of [-8.45, 8.45]) {
        const e = trackAt(s, o);
        edges.push({
          p: [e.x, e.y + 0.07, e.z],
          r: [0, e.heading, e.bank],
          s: [0.1, 0.025, 8],
        });
      }
      if (
        (s > TRACK_LENGTH * 0.2 && s < TRACK_LENGTH * 0.44) ||
        (s > TRACK_LENGTH * 0.7 && s < TRACK_LENGTH * 0.9)
      ) {
        for (const side of [-1, 1]) {
          const e = trackAt(s, side * 10.5);
          barriers.push({
            p: [e.x, e.y + 0.65, e.z],
            r: [0, e.heading, e.bank],
            s: [0.6, 1.15, 7],
            c: Math.floor(s / 20) % 2 ? "#f4d67a" : "#9ddcd3",
          });
        }
      }
      if (s % 30 < 10) {
        const e = trackAt(s);
        supports.push({ p: [e.x, (e.y - 6) / 2, e.z], s: [2.5, e.y + 6, 2.5] });
      }
    }
    this.instances(new T.BoxGeometry(1, 1, 1), this.mat("#d2d4df"), dashes);
    this.instances(new T.BoxGeometry(1, 1, 1), this.mat("#f6eed9"), edges);
    this.instances(new T.BoxGeometry(1, 1, 1), this.mat("#ffffff"), barriers);
    this.instances(new T.BoxGeometry(1, 1, 1), this.mat("#b1acb9"), supports);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 12; col++) {
        const p = trackAt(row * 0.75, (col - 5.5) * 1.45);
        const square = this.box(
          1.46,
          0.035,
          0.76,
          (row + col) % 2 ? "#f8f2df" : "#30364e",
          p.x,
          p.y + 0.08,
          p.z,
        );
        square.rotation.set(0, p.heading, p.bank);
      }
    this.buildGate();
    const question = this.texture((ctx, w, h) => {
      ctx.fillStyle = "#f7d272";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#fff5c8";
      ctx.lineWidth = 13;
      ctx.strokeRect(12, 12, w - 24, h - 24);
      ctx.fillStyle = "#faf8ef";
      ctx.font = "900 190px Arial";
      ctx.textAlign = "center";
      ctx.fillText("?", w / 2, h * 0.78);
    });
    const crateMat = new T.MeshStandardMaterial({
      map: question,
      roughness: 0.35,
      emissive: "#d79515",
      emissiveIntensity: 0.14,
    });
    for (const b of BOXES) {
      const p = trackAt(b.s, b.offset),
        group = new T.Group();
      group.position.set(p.x, p.y + 1.7, p.z);
      const cube = this.mesh(
        new T.BoxGeometry(1.65, 1.65, 1.65),
        crateMat,
        0,
        0,
        0,
        group,
      );
      cube.rotation.z = 0.18;
      const ring = this.mesh(
        new T.TorusGeometry(1.15, 0.035, 5, 28),
        this.mat("#fff4bf", { emissive: "#fff4bf", emissiveIntensity: 0.4 }),
        0,
        -0.6,
        0,
        group,
      );
      ring.rotation.x = Math.PI / 2;
      this.scene.add(group);
      this.crates.push({ group, cube, y: p.y + 1.7 });
    }
    const padTexture = this.texture((ctx, w, h) => {
      ctx.fillStyle = "#82e6df";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#e6fff0";
      ctx.lineWidth = 21;
      for (let y = 40; y < 250; y += 70) {
        ctx.beginPath();
        ctx.moveTo(25, y + 40);
        ctx.lineTo(128, y - 15);
        ctx.lineTo(231, y + 40);
        ctx.stroke();
      }
    });
    for (const pad of PADS) {
      const p = trackAt(pad.s, pad.offset);
      const m = this.mesh(
        new T.PlaneGeometry(4.4, 7),
        new T.MeshStandardMaterial({
          map: padTexture,
          emissive: "#5ac6d1",
          emissiveIntensity: 0.45,
          side: T.DoubleSide,
        }),
        p.x,
        p.y + 0.11,
        p.z,
      );
      m.rotation.set(-Math.PI / 2, 0, -p.heading);
    }
    for (const oil of OILS) {
      const p = trackAt(oil.s, oil.offset),
        m = this.mesh(
          new T.CircleGeometry(2, 24),
          this.mat("#33304f", { metalness: 0.75, roughness: 0.15 }),
          p.x,
          p.y + 0.12,
          p.z,
        );
      m.rotation.x = -Math.PI / 2;
      m.scale.y = 1.5;
    }
    // Panneaux de virages, lisibles depuis le cockpit.
    const arrows = this.texture((ctx, w, h) => {
      ctx.fillStyle = "#f6ce72";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#343a4e";
      ctx.lineWidth = 21;
      for (let x = 20; x < 240; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 55);
        ctx.lineTo(x + 50, 128);
        ctx.lineTo(x, 200);
        ctx.stroke();
      }
    });
    for (const f of [0.13, 0.28, 0.44, 0.59, 0.76, 0.91]) {
      const p = trackAt(f * TRACK_LENGTH, -12);
      const group = new T.Group();
      group.position.set(p.x, p.y, p.z);
      group.rotation.y = p.heading + Math.PI * 0.2;
      this.box(0.2, 3.6, 0.2, "#ededdb", -1.5, 1.8, 0, group);
      this.box(0.2, 3.6, 0.2, "#ededdb", 1.5, 1.8, 0, group);
      this.mesh(
        new T.BoxGeometry(4.6, 2.3, 0.15),
        new T.MeshStandardMaterial({ map: arrows }),
        0,
        3,
        0,
        group,
      );
      this.scene.add(group);
    }
  }
  buildGate() {
    const T = this.T,
      p = trackAt(0),
      gate = new T.Group();
    gate.position.set(p.x, p.y, p.z);
    gate.rotation.y = p.heading;
    for (const x of [-11, 11]) {
      this.box(1, 10, 1, "#f2ded0", x, 5, 0, gate);
      this.box(1.6, 0.7, 1.6, "#ff8255", x, 0.35, 0, gate);
    }
    this.box(23, 2.3, 0.8, "#fc865b", 0, 9.4, 0, gate);
    const banner = this.texture(
      (ctx, w, h) => {
        ctx.fillStyle = "#ff8255";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#303343";
        ctx.font = "900 63px Arial";
        ctx.textAlign = "center";
        ctx.fillText("KART CLUB", w / 2, 82);
        for (let i = 0; i < 12; i++)
          for (let j = 0; j < 2; j++) {
            ctx.fillStyle = (i + j) % 2 ? "#fff4dc" : "#303343";
            ctx.fillRect(4 + i * 22, j * 16 + 8, 22, 16);
            ctx.fillRect(w - 268 + i * 22, j * 16 + 88, 22, 16);
          }
      },
      1024,
      128,
    );
    for (const side of [-1, 1]) {
      const sign = this.mesh(
        new T.PlaneGeometry(22.6, 2.25),
        new T.MeshStandardMaterial({ map: banner }),
        0,
        9.4,
        side * 0.42,
        gate,
      );
      if (side === -1) sign.rotation.y = Math.PI;
    }
    this.scene.add(gate);
  }
  buildScenery() {
    const T = this.T,
      trunks = [],
      leaves = [],
      bushes = [],
      rocks = [],
      flowers = [];
    for (let i = 0; i < 66; i++) {
      const s = ((i + 0.5) / 66) * TRACK_LENGTH,
        side = i % 2 ? -1 : 1;
      const p = trackAt(s, side * (16 + (i % 4) * 4)),
        h = 6 + (i % 5);
      trunks.push({
        p: [p.x, -5.5 + h / 2, p.z],
        s: [0.38, h, 0.38],
        r: [0.08 * side, 0, 0.12 * Math.sin(i)],
      });
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * TAU + i;
        leaves.push({
          p: [
            p.x + Math.cos(a) * 2,
            -5.5 + h + Math.sin(j) * 0.3,
            p.z + Math.sin(a) * 2,
          ],
          s: [3.7, 0.3, 0.85],
          r: [0.05, -a, Math.sin(j) * 0.12],
          c: j % 2 ? "#5c9d7e" : "#78b18b",
        });
      }
      if (i % 2)
        rocks.push({
          p: [p.x + 2, -4.4, p.z - 3],
          s: [2.2 + (i % 3), 2.8 + (i % 4), 2.7],
          r: [0.2, i, 0.1],
          c: i % 3 ? "#c4b1c3" : "#e3b7a0",
        });
      for (let j = 0; j < 3; j++)
        bushes.push({
          p: [p.x + Math.sin(i + j) * 6, -5, p.z + Math.cos(i * j) * 6],
          s: [1.8, 1.4, 1.9],
          c: j % 2 ? "#8db989" : "#afcc94",
        });
      flowers.push({
        p: [p.x + 4, -3.9, p.z + 4],
        s: [1.3, 1.3, 1.3],
        c: ["#f3a6a7", "#f4d48b", "#bba5d6"][i % 3],
      });
    }
    this.instances(
      new T.CylinderGeometry(0.65, 0.9, 1, 7),
      this.mat("#ba9672"),
      trunks,
    );
    this.instances(new T.SphereGeometry(1, 6, 4), this.mat("#ffffff"), leaves);
    this.instances(new T.DodecahedronGeometry(1), this.mat("#ffffff"), rocks);
    this.instances(new T.SphereGeometry(1, 7, 5), this.mat("#ffffff"), bushes);
    this.instances(new T.IcosahedronGeometry(1), this.mat("#ffffff"), flowers);
    // Gradins, parasols et petite fête au bord de la ligne de départ.
    for (let i = 0; i < 9; i++) {
      const p = trackAt(20 + i * 6, 19);
      this.box(
        3,
        0.7 + (i % 2) * 0.7,
        4,
        i % 2 ? "#f2d098" : "#c7afc6",
        p.x,
        p.y - 0.6,
        p.z,
      );
      const pole = this.mesh(
        new T.CylinderGeometry(0.08, 0.08, 5),
        this.mat("#f5e5c6"),
        p.x,
        p.y + 1.7,
        p.z,
      );
      const umbrella = this.mesh(
        new T.ConeGeometry(2.5, 1.2, 8),
        this.mat(COLORS[i % COLORS.length]),
        pole.position.x,
        p.y + 4.4,
        pole.position.z,
      );
      umbrella.rotation.y = i;
    }
    const balloon = new T.Group();
    this.mesh(
      new T.SphereGeometry(8, 12, 12),
      this.mat("#edb890"),
      0,
      0,
      0,
      balloon,
    ).scale.y = 1.2;
    this.mesh(
      new T.CylinderGeometry(1.5, 1, 2, 8),
      this.mat("#9d807d"),
      0,
      -12,
      0,
      balloon,
    );
    for (const x of [-1, 1])
      this.mesh(
        new T.CylinderGeometry(0.04, 0.04, 5, 4),
        this.mat("#8e8280"),
        x,
        -9.5,
        0,
        balloon,
      );
    balloon.position.set(35, 65, -100);
    this.scene.add(balloon);
    this.balloon = balloon;
  }
  makeKart(color, name = "") {
    const T = this.T,
      kart = new T.Group();
    const paint = new T.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.15,
    });
    const chassis = this.mesh(
      new T.BoxGeometry(1.55, 0.45, 2.65),
      paint,
      0,
      0.48,
      0,
      kart,
    );
    chassis.castShadow = true;
    this.mesh(new T.BoxGeometry(1.35, 0.26, 1.1), paint, 0, 0.65, 1.15, kart);
    this.box(1.95, 0.14, 0.2, "#343c4b", 0, 0.34, 1.72, kart);
    this.box(1.95, 0.14, 0.2, "#343c4b", 0, 0.38, -1.43, kart);
    this.box(1.8, 0.16, 0.55, color, 0, 1.02, -1.28, kart);
    this.box(0.78, 0.85, 0.48, "#343c4b", 0, 1.03, -0.3, kart);
    const tireGeo = new T.CylinderGeometry(0.39, 0.39, 0.35, 12);
    for (const x of [-0.94, 0.94])
      for (const z of [-0.92, 0.98]) {
        const tire = this.mesh(tireGeo, this.mat("#303846"), x, 0.4, z, kart);
        tire.rotation.z = Math.PI / 2;
        tire.castShadow = true;
        const hub = this.mesh(
          new T.CylinderGeometry(0.19, 0.19, 0.37, 10),
          this.mat("#b8c4ca", { metalness: 0.7 }),
          x,
          0.4,
          z,
          kart,
        );
        hub.rotation.z = Math.PI / 2;
      }
    this.mesh(
      new T.SphereGeometry(0.46, 14, 12),
      this.mat(color),
      0,
      1.64,
      -0.2,
      kart,
    );
    const visor = this.mesh(
      new T.SphereGeometry(0.47, 14, 10, 0, Math.PI),
      this.mat("#314554", { metalness: 0.5, roughness: 0.2 }),
      0,
      1.67,
      -0.15,
      kart,
    );
    visor.scale.y = 0.4;
    this.mesh(
      new T.BoxGeometry(0.58, 0.58, 0.5),
      this.mat("#f1e9dc"),
      0,
      1.12,
      -0.18,
      kart,
    );
    const wheel = this.mesh(
      new T.TorusGeometry(0.23, 0.045, 6, 18),
      this.mat("#343c4b"),
      0,
      1.08,
      0.5,
      kart,
    );
    wheel.rotation.x = -0.7;
    if (name) {
      const texture = this.texture(
        (ctx, w, h) => {
          ctx.fillStyle = "#242a38d0";
          ctx.beginPath();
          ctx.roundRect(0, 0, w, h, 22);
          ctx.fill();
          ctx.font = "bold 40px Arial";
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(name, w / 2, 55, w - 20);
        },
        512,
        80,
      );
      const label = new T.Sprite(
        new T.SpriteMaterial({ map: texture, depthTest: true }),
      );
      label.position.y = 2.7;
      label.scale.set(3.8, 0.6, 1);
      kart.add(label);
    }
    kart.userData.paint = paint;
    this.scene.add(kart);
    return kart;
  }
  buildCockpit() {
    const T = this.T;
    this.cockpit = new T.Group();
    this.camera.add(this.cockpit);
    this.nose = this.mesh(
      new T.BoxGeometry(0.85, 0.18, 1.5),
      new T.MeshStandardMaterial({
        color: COLORS[0],
        roughness: 0.4,
        metalness: 0.15,
      }),
      0,
      -0.59,
      -1.4,
      this.cockpit,
    );
    this.box(0.15, 0.05, 1.54, "#f6efdf", 0, -0.48, -1.41, this.cockpit);
    for (const side of [-1, 1]) {
      this.box(
        0.23,
        0.2,
        1.05,
        "#303848",
        side * 0.59,
        -0.62,
        -1.37,
        this.cockpit,
      );
      this.mesh(
        new T.SphereGeometry(0.12, 10, 6),
        this.mat("#343c49"),
        side * 0.51,
        -0.45,
        -0.98,
        this.cockpit,
      ).scale.set(1, 0.75, 1.6);
    }
    this.mesh(
      new T.BoxGeometry(1.48, 0.18, 0.35),
      this.mat("#2e3746"),
      0,
      -0.59,
      -0.8,
      this.cockpit,
    );
    this.wheel = new T.Group();
    this.wheel.position.set(0, -0.45, -0.78);
    this.wheel.rotation.x = -0.18;
    this.cockpit.add(this.wheel);
    this.mesh(
      new T.TorusGeometry(0.285, 0.041, 12, 48),
      this.mat("#242e3c"),
      0,
      0,
      0,
      this.wheel,
    );
    this.mesh(
      new T.TorusGeometry(0.243, 0.008, 6, 48),
      this.mat("#a1b6b6", { metalness: 0.5 }),
      0,
      0,
      -0.01,
      this.wheel,
    );
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * TAU + Math.PI / 2;
      const spoke = this.box(
        0.04,
        0.25,
        0.026,
        "#a1acb5",
        Math.cos(angle) * 0.12,
        Math.sin(angle) * 0.12,
        0.008,
        this.wheel,
      );
      spoke.rotation.z = angle - Math.PI / 2;
    }
    this.mesh(
      new T.CylinderGeometry(0.075, 0.075, 0.05, 24),
      this.mat("#ff8659"),
      0,
      0,
      0.03,
      this.wheel,
    ).rotation.x = Math.PI / 2;
    this.box(0.021, 0.052, 0.009, "#f5edcc", 0, 0.275, 0.035, this.wheel);
    for (const side of [-1, 1]) {
      const hand = this.mesh(
        new T.SphereGeometry(0.064, 12, 8),
        this.mat("#e3eddf"),
        side * 0.274,
        0.012,
        0.035,
        this.wheel,
      );
      hand.scale.set(1, 1.6, 0.8);
      this.box(
        0.1,
        0.035,
        0.03,
        "#88c5b3",
        side * 0.276,
        -0.045,
        0.066,
        this.wheel,
      );
      const arm = this.mesh(
        new T.CylinderGeometry(0.048, 0.07, 0.4, 10),
        this.mat("#e2e9de"),
        side * 0.3,
        -0.19,
        0.14,
        this.wheel,
      );
      arm.rotation.x = -0.5;
      arm.rotation.z = side * -0.14;
    }
    const light = new T.PointLight("#fff0d5", 1.3, 3);
    light.position.set(0, 0.25, -0.1);
    this.cockpit.add(light);
    this.cockpit.visible = false;
  }
  buildParticles() {
    const T = this.T;
    this.particlePositions = new Float32Array(240 * 3);
    this.particleColors = new Float32Array(240 * 3);
    const g = new T.BufferGeometry();
    g.setAttribute(
      "position",
      new T.BufferAttribute(this.particlePositions, 3),
    );
    g.setAttribute("color", new T.BufferAttribute(this.particleColors, 3));
    this.particleMesh = new T.Points(
      g,
      new T.PointsMaterial({
        size: 0.18,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
  }
  emitParticle(p, boosting) {
    const at = trackAt(
      p.s - 0.4,
      p.offset + (Math.random() > 0.5 ? 1 : -1) * 0.9,
    );
    this.particles.push({
      x: at.x,
      y: at.y + 0.2,
      z: at.z,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 2.5,
      vz: (Math.random() - 0.5) * 3,
      life: 0.3 + Math.random() * 0.4,
      color: boosting
        ? [0.3, 1, 1]
        : p.drift > 1.8
          ? [0.3, 1, 1]
          : [1, 0.6, 0.15],
    });
    if (this.particles.length > 240) this.particles.shift();
  }
  setMode(mode, color = COLORS[0]) {
    this.mode = mode;
    this.cameraReady = false;
    this.cockpit.visible = mode === "race";
    this.nose.material.color.set(color);
  }
  update(race, myId, input, dt, time) {
    const T = this.T;
    this.time = time;
    const racing = this.mode === "race";
    const me = race?.players.find((p) => p.id === myId);
    const players =
      racing && race
        ? race.players
        : [
            {
              id: "showroom",
              name: "",
              color: this.color || COLORS[0],
              s: TRACK_LENGTH * 0.045,
              offset: -2.5,
              angle: 0,
              speed: 0,
            },
            ...COLORS.slice(1, 4).map((color, i) => ({
              id: `demo-${i}`,
              name: "",
              color,
              s: TRACK_LENGTH * (0.3 + i * 0.23) + time * (13 + i),
              offset: Math.sin(time * 0.25 + i) * 3,
              angle: 0,
              speed: 18,
            })),
          ];
    const visible = new Set();
    for (const p of players) {
      visible.add(p.id);
      let kart = this.karts.get(p.id);
      if (!kart) {
        kart = this.makeKart(p.color, racing && p.id !== myId ? p.name : "");
        this.karts.set(p.id, kart);
      }
      kart.visible = !(racing && p.id === myId);
      kart.scale.setScalar(p.id === "showroom" ? 2.2 : 1);
      kart.userData.paint.color.set(p.color);
      const at = trackAt(p.s, p.offset);
      const smooth = Math.min(1, dt * 18);
      if (!kart.userData.initialized || !racing)
        kart.position.set(at.x, at.y, at.z);
      else kart.position.lerp(new T.Vector3(at.x, at.y, at.z), smooth);
      kart.userData.initialized = true;
      kart.rotation.set(
        0,
        at.heading - p.angle + (p.stun > 0 ? p.stun * 8 : 0),
        -at.bank - (p.steer || 0) * 0.04,
      );
      if (racing && (p.drift > 0.1 || p.boosting > 0)) {
        this.emitParticle(p, p.boosting > 0);
        if (p.id === myId) this.emitParticle(p, p.boosting > 0);
      }
    }
    for (const [id, kart] of this.karts)
      if (!visible.has(id)) kart.visible = false;
    this.crates.forEach((b, i) => {
      b.group.rotation.y = time * 1.15 + i;
      b.group.position.y = b.y + Math.sin(time * 2 + i) * 0.25;
      const available = !racing || !me || (me.boxTimers[i] || 0) < race.clock;
      b.group.scale.setScalar(available ? 1 : 0.22);
    });
    const alive = new Set();
    for (const h of racing && race ? race.hazards : []) {
      alive.add(h.id);
      let mesh = this.hazardMeshes.get(h.id);
      if (!mesh) {
        mesh = this.makeHazard(h.type);
        this.scene.add(mesh);
        this.hazardMeshes.set(h.id, mesh);
      }
      const at = trackAt(h.s, h.offset);
      mesh.position.set(at.x, at.y + 0.4, at.z);
      mesh.rotation.y = time * (h.type === "banana" ? 0.5 : 9);
    }
    for (const [id, mesh] of this.hazardMeshes)
      if (!alive.has(id)) {
        this.scene.remove(mesh);
        this.hazardMeshes.delete(id);
        mesh.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
        });
      }
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    this.particlePositions.fill(0);
    this.particles.forEach((p, i) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.particlePositions.set([p.x, p.y, p.z], i * 3);
      this.particleColors.set(p.color, i * 3);
    });
    this.particleMesh.geometry.setDrawRange(0, this.particles.length);
    this.particleMesh.geometry.attributes.position.needsUpdate = true;
    this.particleMesh.geometry.attributes.color.needsUpdate = true;
    this.balloon.position.y = 65 + Math.sin(time * 0.25) * 2;
    if (racing && me) {
      const at = trackAt(me.s, me.offset),
        ahead = trackAt(me.s + 15, me.offset + Math.sin(me.angle) * 10);
      const pos = new T.Vector3(
        at.x,
        at.y + 1.35 + (me.speed > 2 ? Math.sin(time * 35) * 0.012 : 0),
        at.z,
      );
      if (!this.cameraReady) this.camera.position.copy(pos);
      else this.camera.position.lerp(pos, Math.min(1, dt * 20));
      this.camera.up
        .set(-Math.sin(at.bank) * at.tz, 1, Math.sin(at.bank) * at.tx)
        .normalize();
      this.camera.lookAt(ahead.x, ahead.y + 1.25, ahead.z);
      this.camera.fov +=
        ((me.boosting > 0 ? 83 : 74) - this.camera.fov) * Math.min(1, dt * 5);
      this.wheel.rotation.z +=
        (-input.steer * 0.75 - this.wheel.rotation.z) * Math.min(1, dt * 12);
      this.cockpit.rotation.z = Math.sin(time * 4) * (me.stun > 0 ? 0.09 : 0);
    } else {
      const at = trackAt(TRACK_LENGTH * 0.045);
      this.camera.position.set(
        at.x + 19 + Math.sin(time * 0.065) * 2,
        at.y + 11,
        at.z + 24,
      );
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(at.x - 13, at.y + 1.8, at.z - 16);
      this.camera.fov = 57;
    }
    this.cameraReady = true;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
  makeHazard(type) {
    const T = this.T,
      group = new T.Group();
    if (type === "banana") {
      for (let i = 0; i < 3; i++) {
        const peel = this.mesh(
          new T.ConeGeometry(0.21, 1.1, 5),
          this.mat("#f8d463"),
          Math.sin((i * TAU) / 3) * 0.32,
          0.08,
          Math.cos((i * TAU) / 3) * 0.32,
          group,
        );
        peel.rotation.set(
          Math.cos((i * TAU) / 3) * 1.1,
          0,
          -Math.sin((i * TAU) / 3) * 1.1,
        );
      }
      this.mesh(
        new T.ConeGeometry(0.15, 0.6, 5),
        this.mat("#f9de7a"),
        0,
        0.3,
        0,
        group,
      );
    } else {
      const shell = this.mesh(
        new T.SphereGeometry(0.65, 10, 6),
        this.mat(type === "red" ? "#ed715e" : "#7bbd85"),
        0,
        0.12,
        0,
        group,
      );
      shell.scale.y = 0.6;
      this.mesh(
        new T.TorusGeometry(0.6, 0.1, 6, 16),
        this.mat("#f7eac8"),
        0,
        0,
        0,
        group,
      ).rotation.x = Math.PI / 2;
    }
    return group;
  }
}

export function drawMap(canvas, players = [], myId = "", dark = false) {
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const scale = Math.min((w - 38) / 265, (h - 28) / 290);
  const map = (p) => [w / 2 + p.x * scale, h / 2 + p.z * scale * 0.92];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [lineWidth, strokeStyle] of [
    [dark ? 11 : 9, dark ? "#ffffff20" : "#d5dcd0"],
    [dark ? 4 : 3.5, dark ? "#e6f0e6" : "#707c76"],
  ]) {
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const pos = map(trackAt((i / 200) * TRACK_LENGTH));
      if (!i) ctx.moveTo(...pos);
      else ctx.lineTo(...pos);
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  const start = map(trackAt(0));
  ctx.fillStyle = "#ff7045";
  ctx.fillRect(start[0] - 4, start[1] - 4, 8, 8);
  for (const p of [...players].sort(
    (a, b) => (a.id === myId) - (b.id === myId),
  )) {
    const pos = map(trackAt(p.s, p.offset));
    ctx.beginPath();
    ctx.arc(...pos, p.id === myId ? 6 : 4, 0, TAU);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = p.id === myId ? "#fff" : "#242a38";
    ctx.lineWidth = p.id === myId ? 2 : 1;
    ctx.stroke();
  }
}
