import {
  getTrack,
  projectTrack,
  hasRail,
  angleDelta,
  COLORS,
  TAU,
  clamp,
} from "./shared.js";
import { PostProcessing } from "./post.js";

export class World {
  constructor(T, canvas) {
    this.T = T;
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(
      72,
      innerWidth / innerHeight,
      0.05,
      1800,
    );
    this.scene.add(this.camera);
    this.level = new T.Group();
    this.scene.add(this.level);
    this.materials = new Map();
    this.karts = new Map();
    this.hazardMeshes = new Map();
    this.crates = [];
    this.particles = [];
    this.animated = [];
    this.weather = null;
    this.cameraReady = false;
    this.mode = "home";
    this.hemi = new T.HemisphereLight("#fff2de", "#505a77", 1.25);
    this.scene.add(this.hemi);
    this.sun = new T.DirectionalLight("#ffd9a0", 2.7);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, {
      left: -65,
      right: 65,
      top: 65,
      bottom: -65,
      near: 1,
      far: 280,
    });
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);
    this.boostLight = new T.PointLight("#77edff", 0, 13, 2);
    this.camera.add(this.boostLight);
    this.boostLight.position.set(0, 0, -2);
    this.buildCockpit();
    this.protectedMaterials = new Set();
    this.camera.traverse((o) => {
      if (o.material) this.protectedMaterials.add(o.material);
    });
    this.post = new PostProcessing(T, this.renderer);
    this.setQuality(innerWidth < 600 ? "balanced" : "high");
    this.setTrack("sunset");
    window.addEventListener("resize", () => this.resize());
  }
  setQuality(quality) {
    this.quality = ["high", "balanced", "low"].includes(quality)
      ? quality
      : "balanced";
    this.renderer.shadowMap.enabled = this.quality !== "low";
    this.sun.shadow.mapSize.set(
      this.quality === "high" ? 2048 : 1024,
      this.quality === "high" ? 2048 : 1024,
    );
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
    document.body.dataset.quality = this.quality;
  }
  resize() {
    const ratio = Math.min(
      devicePixelRatio,
      this.quality === "high" ? 1.75 : this.quality === "balanced" ? 1.25 : 1,
    );
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.post.resize(innerWidth, innerHeight, ratio, this.quality);
  }
  setTrack(id) {
    const track = getTrack(id);
    if (this.track?.id === track.id) return;
    const geometries = new Set(),
      materials = new Set(),
      textures = new Set();
    this.level.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      for (const m of Array.isArray(o.material)
        ? o.material
        : o.material
          ? [o.material]
          : [])
        if (!this.protectedMaterials.has(m)) {
          materials.add(m);
          for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
        }
    });
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    materials.forEach((m) => m.dispose());
    this.level.clear();
    this.materials.clear();
    this.karts.clear();
    this.hazardMeshes.clear();
    this.crates = [];
    this.particles = [];
    this.animated = [];
    this.weather = null;
    this.track = track;
    this.cameraReady = false;
    this.scene.background = new this.T.Color(track.sky);
    this.scene.fog = new this.T.FogExp2(
      track.fog,
      track.theme === "city" ? 0.0022 : 0.0016,
    );
    this.hemi.color.set(
      track.theme === "city"
        ? "#9caed4"
        : track.theme === "lava"
          ? "#a57c86"
          : track.fill,
    );
    this.hemi.groundColor.set(track.theme === "lava" ? "#77372d" : "#242b45");
    this.hemi.intensity = track.theme === "city" ? 1.35 : 1.5;
    this.sun.color.set(track.light);
    this.sun.intensity = track.theme === "city" ? 1.3 : 2.7;
    this.post.theme(track);
    this.buildSky();
    this.buildTrack();
    this.buildEnvironment();
    this.buildParticles();
    document.body.dataset.track = track.id;
  }
  mat(color, options = {}) {
    const key = color + JSON.stringify(options);
    if (!this.materials.has(key))
      this.materials.set(
        key,
        new this.T.MeshStandardMaterial({ color, roughness: 0.75, ...options }),
      );
    return this.materials.get(key);
  }
  mesh(geo, material, x = 0, y = 0, z = 0, parent = this.level) {
    const m = new this.T.Mesh(geo, material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
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
  texture(draw, width = 512, height = 512) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    draw(c.getContext("2d"), width, height);
    const t = new this.T.CanvasTexture(c);
    t.colorSpace = this.T.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  instances(geo, material, transforms, shadows = true) {
    const T = this.T,
      m = new T.InstancedMesh(geo, material, transforms.length),
      d = new T.Object3D();
    transforms.forEach((t, i) => {
      d.position.set(...t.p);
      d.rotation.set(...(t.r || [0, 0, 0]));
      d.scale.set(...(t.s || [1, 1, 1]));
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      if (t.c) m.setColorAt(i, new T.Color(t.c));
    });
    m.castShadow = shadows;
    m.receiveShadow = true;
    this.level.add(m);
    return m;
  }
  buildSky() {
    const T = this.T,
      t = this.track;
    const sky = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      vertexShader:
        "varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec3 v;uniform vec3 top;uniform vec3 bottom;void main(){float h=normalize(v).y;vec3 c=mix(bottom,top,smoothstep(-.08,.23,h));gl_FragColor=vec4(c,1.);}",
      uniforms: {
        top: { value: new T.Color(t.sky) },
        bottom: { value: new T.Color(t.horizon) },
      },
      toneMapped: false,
    });
    this.mesh(new T.SphereGeometry(1100, 32, 16), sky, 0, 100, 0);
    this.mesh(
      new T.SphereGeometry(t.theme === "city" ? 15 : 27, 32, 16),
      new T.MeshBasicMaterial({
        color:
          t.theme === "snow"
            ? "#e5f8ff"
            : t.theme === "lava"
              ? "#f78c4f"
              : "#fff0c0",
        fog: false,
      }),
      -350,
      200,
      -550,
    );
    if (t.theme === "city" || t.theme === "snow") {
      const stars = [];
      for (let i = 0; i < 850; i++) {
        const a = i * 2.399,
          rad = 650 + Math.sin(i) * 150;
        stars.push(
          Math.sin(a) * rad,
          180 + Math.abs(Math.sin(i * 9.8)) * 550,
          Math.cos(a) * rad,
        );
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(stars, 3));
      this.level.add(
        new T.Points(
          g,
          new T.PointsMaterial({
            color: "#e6e8ff",
            size: 1.5,
            sizeAttenuation: true,
            fog: false,
          }),
        ),
      );
    }
    if (t.theme === "snow") {
      const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        uniforms: { time: { value: 0 } },
        vertexShader:
          "varying vec2 uv0;uniform float time;void main(){uv0=uv;vec3 p=position;p.y+=sin(p.x*.01+time*.12)*25.;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}",
        fragmentShader:
          "varying vec2 uv0;uniform float time;void main(){float a=sin(uv0.x*24.+sin(uv0.x*7.+time*.1)*3.)*.13+.4;float band=exp(-abs(uv0.y-a)*12.);vec3 c=mix(vec3(.2,1.2,.8),vec3(.5,.3,1.2),uv0.y);gl_FragColor=vec4(c,band*.45);}",
      });
      const aurora = this.mesh(
        new T.PlaneGeometry(1300, 260, 120, 12),
        mat,
        0,
        290,
        -550,
      );
      aurora.rotation.z = 0.12;
      this.animated.push({ type: "shader", material: mat });
    }
  }
  asphalt() {
    const T = this.T;
    const tex = this.texture(
      (ctx, w, h) => {
        const image = ctx.createImageData(w, h);
        let seed = 9187;
        for (let i = 0; i < image.data.length; i += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const n = 155 + (seed >>> 27);
          image.data[i] = n;
          image.data[i + 1] = n;
          image.data[i + 2] = n + 3;
          image.data[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = "#45464c";
        ctx.lineWidth = 3;
        for (let i = 0; i < 50; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 47, 0);
          ctx.bezierCurveTo(i * 47 + 17, 700, i * 47 - 20, 1500, i * 47, 2048);
          ctx.stroke();
        }
      },
      2048,
      2048,
    );
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return new T.MeshStandardMaterial({
      color: this.track.road,
      map: tex,
      bumpMap: tex,
      bumpScale: 0.018,
      roughness:
        this.track.theme === "city"
          ? 0.3
          : this.track.theme === "snow"
            ? 0.38
            : 0.87,
      metalness: this.track.theme === "city" ? 0.35 : 0.08,
      side: T.DoubleSide,
    });
  }
  ribbon(from, to, material, lift = 0) {
    const T = this.T,
      vs = [],
      uvs = [],
      indices = [],
      count = Math.ceil(this.track.length / 2.5);
    for (let i = 0; i <= count; i++) {
      const s = (i / count) * this.track.length;
      for (const offset of [from, to]) {
        const p = this.track.at(s, offset);
        vs.push(p.x, p.y + lift, p.z);
        uvs.push(offset === from ? 0 : 1, s / 32);
      }
    }
    for (let i = 0; i < count; i++) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(vs, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const m = this.mesh(g, material);
    m.receiveShadow = true;
    m.castShadow = true;
    return m;
  }
  buildTrack() {
    const T = this.T,
      t = this.track,
      h = t.halfWidth;
    this.ribbon(-h, h, this.asphalt());
    for (const side of [-1, 1]) {
      this.ribbon(side * h, side * (h + 0.75), this.mat(t.edge), 0.035);
      this.ribbon(
        side * (h + 0.75),
        side * t.supportWidth,
        this.mat(
          t.theme === "snow"
            ? "#dcebf1"
            : t.theme === "coast"
              ? "#ceb582"
              : "#514352",
        ),
        -0.03,
      );
    }
    this.ribbon(
      -t.supportWidth,
      t.supportWidth,
      this.mat(
        t.theme === "city"
          ? "#20283f"
          : t.theme === "snow"
            ? "#b5d5dc"
            : "#59494d",
      ),
      -0.65,
    );
    const lines = [],
      curbs = [],
      rails = [],
      posts = [],
      supports = [];
    for (let s = 0; s < t.length; s += 5) {
      const p = t.at(s);
      if (Math.floor(s / 5) % 2 === 0)
        lines.push({
          p: [p.x, p.y + 0.045, p.z],
          r: [0, p.heading, -p.bank],
          s: [0.14, 0.02, 3],
        });
      for (const side of [-1, 1]) {
        const e = t.at(s, side * (h + 0.35));
        curbs.push({
          p: [e.x, e.y + 0.09, e.z],
          r: [0, e.heading, -e.bank],
          s: [0.7, 0.12, 2.5],
          c: Math.floor(s / 5) % 2 ? t.edge : t.accent,
        });
        if (hasRail(t, s, side)) {
          const q = t.at(s, side * (h + 0.95));
          rails.push({
            p: [q.x, q.y + 0.8, q.z],
            r: [0, q.heading, 0],
            s: [0.22, 0.48, 5.1],
          });
          posts.push({ p: [q.x, q.y + 0.42, q.z], s: [0.3, 1.1, 0.3] });
        }
      }
      if (s % 25 < 5)
        supports.push({
          p: [p.x, (p.y - 35) / 2, p.z],
          s: [2.5, p.y + 35, 2.5],
        });
    }
    this.instances(
      new T.BoxGeometry(1, 1, 1),
      this.mat(t.theme === "city" ? "#78ffff" : "#eee5d3", {
        emissive: t.theme === "city" ? "#4bd5e7" : "#000000",
        emissiveIntensity: 0.65,
      }),
      lines,
      false,
    );
    this.instances(
      new T.BoxGeometry(1, 1, 1),
      this.mat("#ffffff"),
      curbs,
      false,
    );
    this.instances(
      new T.BoxGeometry(1, 1, 1),
      this.mat(t.theme === "city" ? t.accent : "#d1c7b5", {
        metalness: 0.5,
        roughness: 0.35,
        emissive: t.theme === "city" ? t.accent : "#000000",
        emissiveIntensity: 0.6,
      }),
      rails,
    );
    this.instances(
      new T.BoxGeometry(1, 1, 1),
      this.mat("#707487", { metalness: 0.45 }),
      posts,
    );
    this.instances(
      new T.CylinderGeometry(1, 0.8, 1, 6),
      this.mat(
        t.theme === "city"
          ? "#344054"
          : t.theme === "snow"
            ? "#9ebdce"
            : "#76605c",
      ),
      supports,
    );
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 12; col++) {
        const p = t.at(row * 0.75, (col - 5.5) * (t.width / 12));
        const m = this.box(
          t.width / 12,
          0.02,
          0.75,
          (row + col) % 2 ? "#fff5de" : "#151a31",
          p.x,
          p.y + 0.065,
          p.z,
        );
        m.rotation.set(0, p.heading, -p.bank);
      }
    this.buildGate();
    const tex = this.texture((ctx, w, h) => {
      ctx.fillStyle = "#f8bc50";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#fff3bb";
      ctx.lineWidth = 22;
      ctx.strokeRect(20, 20, w - 40, h - 40);
      ctx.fillStyle = "#fff9e5";
      ctx.font = "900 380px Arial";
      ctx.textAlign = "center";
      ctx.fillText("?", w / 2, h * 0.8);
    });
    const material = new T.MeshStandardMaterial({
      map: tex,
      color: "#ffffff",
      emissive: "#f5b84c",
      emissiveMap: tex,
      emissiveIntensity: 0.4,
      metalness: 0.25,
      roughness: 0.25,
    });
    for (const b of t.boxes) {
      const p = t.at(b.s, b.offset),
        group = new T.Group();
      group.position.set(p.x, p.y + 1.6, p.z);
      const cube = this.mesh(
        new T.BoxGeometry(1.6, 1.6, 1.6),
        material,
        0,
        0,
        0,
        group,
      );
      cube.rotation.z = 0.2;
      this.level.add(group);
      this.crates.push({ group, y: p.y + 1.6 });
    }
    const padTex = this.texture((ctx, w, h) => {
      ctx.fillStyle = "#1d929f";
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 35;
      ctx.strokeStyle = "#b9ffff";
      for (let y = 60; y < h; y += 150) {
        ctx.beginPath();
        ctx.moveTo(30, y + 80);
        ctx.lineTo(w / 2, y);
        ctx.lineTo(w - 30, y + 80);
        ctx.stroke();
      }
    });
    for (const pad of t.pads) {
      const p = t.at(pad.s, pad.offset);
      const m = this.mesh(
        new T.PlaneGeometry(4.5, 7),
        new T.MeshStandardMaterial({
          map: padTex,
          emissiveMap: padTex,
          emissive: "#78ffff",
          emissiveIntensity: 1.8,
          side: T.DoubleSide,
        }),
        p.x,
        p.y + 0.09,
        p.z,
      );
      m.rotation.set(-Math.PI / 2, 0, -p.heading);
    }
    for (const oil of t.oils) {
      const p = t.at(oil.s, oil.offset);
      const m = this.mesh(
        new T.CircleGeometry(2, 32),
        this.mat("#131329", { metalness: 0.9, roughness: 0.12 }),
        p.x,
        p.y + 0.08,
        p.z,
      );
      m.rotation.x = -Math.PI / 2;
      m.scale.y = 1.4;
    }
    // Signalisation de tous les virages marqués, visible avant le freinage.
    for (let s = 50; s < t.length; s += 65) {
      const a = t.at(s),
        b = t.at(s + 22),
        turn = angleDelta(b.heading - a.heading);
      if (Math.abs(turn) > 0.18) {
        const side = turn > 0 ? 1 : -1,
          p = t.at(s, side * (h + 3));
        this.sign(p, turn > 0 ? "< < <" : "> > >", t.accent, 5, 2.4);
      }
    }
  }
  sign(p, text, color, width = 12, height = 3) {
    const T = this.T,
      tex = this.texture(
        (ctx, w, h) => {
          ctx.fillStyle = "#131a2b";
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = color;
          ctx.lineWidth = 12;
          ctx.strokeRect(7, 7, w - 14, h - 14);
          ctx.fillStyle = color;
          ctx.font = "900 100px Arial";
          ctx.textAlign = "center";
          ctx.fillText(text, w / 2, h * 0.68, w - 40);
        },
        1024,
        256,
      );
    const g = new T.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading + Math.PI;
    for (const x of [-width * 0.4, width * 0.4])
      this.box(0.18, 4, 0.18, "#6b7382", x, 2, 0, g);
    this.mesh(
      new T.BoxGeometry(width, height, 0.25),
      new T.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: "#ffffff",
        emissiveIntensity: this.track.theme === "city" ? 1.4 : 0.2,
      }),
      0,
      4.1,
      0,
      g,
    );
    this.level.add(g);
    return g;
  }
  buildGate() {
    const T = this.T,
      t = this.track,
      p = t.at(0),
      g = new T.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    for (const x of [-t.halfWidth - 1, t.halfWidth + 1]) {
      const pole = this.box(0.7, 9, 0.7, t.accent, x, 4.5, 0, g);
      pole.castShadow = true;
      this.box(1.2, 0.4, 1.2, t.edge, x, 0.2, 0, g);
    }
    this.box(t.width + 3, 1.9, 0.6, t.accent, 0, 8.4, 0, g);
    const tex = this.texture(
      (ctx, w, h) => {
        ctx.fillStyle = "#171e31";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = t.accent;
        ctx.font = "900 130px Arial";
        ctx.textAlign = "center";
        ctx.fillText("KART CLUB", w / 2, 175);
      },
      2048,
      256,
    );
    for (const side of [-1, 1]) {
      const m = this.mesh(
        new T.PlaneGeometry(t.width + 2.7, 1.85),
        new T.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: "#ffffff",
          emissiveIntensity: t.theme === "city" ? 1 : 0.1,
        }),
        0,
        8.4,
        side * 0.31,
        g,
      );
      if (side < 0) m.rotation.y = Math.PI;
    }
    this.level.add(g);
  }
  palmLeaf() {
    const T = this.T,
      positions = [],
      uv = [],
      indices = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12,
        x = u * 6,
        y = Math.sin(u * Math.PI) * 1.3 - u * u * 0.8,
        w = Math.sin(u * Math.PI) * 0.75;
      for (const side of [-1, 1]) {
        positions.push(x, y, side * w);
        uv.push(u, (side + 1) / 2);
      }
    }
    for (let i = 0; i < 12; i++) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }
  cliffGeometry() {
    const T = this.T,
      g = new T.CylinderGeometry(1, 0.52, 1, 16, 7),
      p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i),
        a = Math.atan2(z, x);
      const scale =
        1 + Math.sin(a * 5 + y * 9) * 0.075 + Math.sin(a * 9 - y * 11) * 0.04;
      p.setXYZ(i, x * scale, y, z * scale);
    }
    g.computeVertexNormals();
    return g;
  }
  rockMaterial() {
    const T = this.T,
      tex = this.texture(
        (ctx, w, h) => {
          const data = ctx.createImageData(w, h);
          let seed = 324;
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
              const strata =
                Math.sin(y * 0.14 + Math.sin(x * 0.009) * 7) * 9 +
                Math.sin(y * 0.035 + x * 0.002) * 14;
              const c = 185 + strata + (seed >>> 28),
                i = (y * w + x) * 4;
              data.data[i] = c;
              data.data[i + 1] = c;
              data.data[i + 2] = c;
              data.data[i + 3] = 255;
            }
          ctx.putImageData(data, 0, 0);
        },
        1024,
        2048,
      );
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return new T.MeshStandardMaterial({
      color: "#ffffff",
      map: tex,
      bumpMap: tex,
      bumpScale: 0.28,
      roughness: 0.95,
    });
  }
  roundedGeo(w, h, d, r) {
    const T = this.T,
      g = new T.BoxGeometry(w, h, d, 6, 4, 6),
      p = g.attributes.position,
      n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i),
        cx = clamp(x, -w / 2 + r, w / 2 - r),
        cy = clamp(y, -h / 2 + r, h / 2 - r),
        cz = clamp(z, -d / 2 + r, d / 2 - r);
      const v = new T.Vector3(x - cx, y - cy, z - cz).normalize();
      p.setXYZ(i, cx + v.x * r, cy + v.y * r, cz + v.z * r);
      n.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
  }
  buildEnvironment() {
    const T = this.T,
      t = this.track,
      noise = (i) => {
        const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
      };
    const trunks = [],
      crowns = [],
      rocks = [],
      foundations = [],
      caps = [],
      plants = [],
      mountains = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU,
        r = 420 + noise(i) * 130;
      mountains.push({
        p: [Math.sin(a) * r, -25, Math.cos(a) * r],
        s: [
          70 + noise(i + 8) * 65,
          130 + noise(i + 4) * 180,
          70 + noise(i + 9) * 75,
        ],
        r: [0, a, 0],
        c:
          t.theme === "snow"
            ? "#a8c5d8"
            : t.theme === "lava"
              ? "#382836"
              : "#b49b9f",
      });
    }
    if (t.theme !== "city")
      this.instances(
        new T.ConeGeometry(1, 1, 6),
        this.mat("#ffffff"),
        mountains,
      );
    if (t.theme === "city") this.buildCity(noise);
    else {
      for (let i = 0; i < Math.ceil(t.length / 9); i++) {
        const s = i * 9,
          side = i % 2 ? 1 : -1,
          p = t.at(s, side * (t.halfWidth + 8 + noise(i) * 13)),
          size = 4 + noise(i + 1) * 5;
        const base = t.theme === "snow" ? -50 : t.theme === "lava" ? -25 : -35;
        foundations.push({
          p: [p.x, (p.y - 4 + base) / 2, p.z],
          s: [size, p.y - 4 - base, size],
          r: [0, i * 0.7, 0],
          c:
            t.theme === "snow"
              ? "#adc2d1"
              : t.theme === "lava"
                ? "#514048"
                : "#bda284",
        });
        caps.push({
          p: [p.x, p.y - 3.85, p.z],
          s: [size, 0.45, size],
          r: [0, i * 0.7, 0],
        });
        if (t.theme === "coast") {
          const h = 8 + noise(i + 3) * 7;
          trunks.push({
            p: [p.x, p.y - 4 + h / 2, p.z],
            s: [0.5, h, 0.5],
            r: [0.08 * side, 0, 0.08],
          });
          for (let j = 0; j < 7; j++) {
            const a = (j / 7) * TAU + i;
            crowns.push({
              p: [p.x, p.y - 4 + h + Math.sin(j) * 0.2, p.z],
              s: [0.9 + noise(j + i) * 0.2, 1, 1],
              r: [0, -a, Math.sin(j) * 0.12],
              c: j % 2 ? "#327d6c" : "#6aa276",
            });
          }
          for (let j = 0; j < 4; j++)
            plants.push({
              p: [
                p.x + (noise(i + j * 2) - 0.5) * 7,
                p.y - 4.5,
                p.z + (noise(i + j * 3) - 0.5) * 7,
              ],
              s: [1.4, 1.5, 1.4],
              c: j % 2 ? "#79aa75" : "#d9a08c",
            });
        } else if (t.theme === "snow") {
          const h = 8 + noise(i + 3) * 8;
          trunks.push({ p: [p.x, p.y - 4 + h / 2, p.z], s: [0.45, h, 0.45] });
          for (let j = 0; j < 3; j++)
            crowns.push({
              p: [p.x, p.y - 1 + h * 0.35 + j * h * 0.2, p.z],
              s: [3.4 - j * 0.6, h * 0.55, 3.4 - j * 0.6],
              c: j % 2 ? "#b7d9df" : "#356c7c",
            });
          if (i % 5 === 0)
            rocks.push({
              p: [p.x + 5, p.y - 1, p.z],
              s: [1.4, 7 + noise(i) * 5, 1.4],
              r: [0, i, 0.2],
              c: "#7bd7ed",
            });
        } else {
          const h = 8 + noise(i + 3) * 25;
          rocks.push({
            p: [p.x, p.y - 5 + h / 2, p.z],
            s: [3, h, 3],
            r: [0, i, 0.08 * side],
            c: i % 3 ? "#322c39" : "#7b443c",
          });
          if (i % 3 === 0) {
            const fissure = this.mesh(
              new T.CylinderGeometry(0.2, 0.8, 8, 5),
              this.mat("#ff5a1e", {
                emissive: "#ff5a1e",
                emissiveIntensity: 3,
              }),
              p.x + 2,
              p.y + 1,
              p.z,
            );
            fissure.rotation.z = 0.17;
          }
        }
      }
      this.instances(this.cliffGeometry(), this.rockMaterial(), foundations);
      this.instances(
        new T.CylinderGeometry(1, 1, 0.8, 16),
        this.mat(
          t.theme === "snow"
            ? "#e6f2f8"
            : t.theme === "lava"
              ? "#563739"
              : "#6e9879",
        ),
        caps,
      );
      if (trunks.length)
        this.instances(
          new T.CylinderGeometry(0.7, 1, 1, 7),
          this.mat(t.theme === "snow" ? "#665b65" : "#9c7359"),
          trunks,
        );
      if (crowns.length)
        this.instances(
          t.theme === "snow" ? new T.ConeGeometry(1, 1, 12) : this.palmLeaf(),
          this.mat("#ffffff", { side: T.DoubleSide }),
          crowns,
        );
      if (plants.length)
        this.instances(
          new T.IcosahedronGeometry(1),
          this.mat("#ffffff"),
          plants,
        );
      if (rocks.length)
        this.instances(
          new T.CylinderGeometry(0.7, 1, 1, 6),
          this.mat("#ffffff", {
            roughness: 0.4,
            metalness: t.theme === "snow" ? 0.3 : 0.1,
          }),
          rocks,
        );
    }
    if (t.theme === "coast") {
      const sea = this.mesh(
        new T.PlaneGeometry(3000, 3000, 1, 1),
        new T.ShaderMaterial({
          uniforms: { time: { value: 0 } },
          vertexShader:
            "varying vec2 uv0;void main(){uv0=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
          fragmentShader:
            "varying vec2 uv0;uniform float time;void main(){float wave=sin(uv0.x*500.+time*.8)*sin(uv0.y*600.-time*.6);vec3 c=mix(vec3(.025,.22,.3),vec3(.08,.45,.48),wave*.25+.5);c+=pow(max(0.,wave),12.)*.08;gl_FragColor=vec4(c,1.);}",
          side: T.DoubleSide,
        }),
        0,
        -34,
        0,
      );
      sea.rotation.x = -Math.PI / 2;
      this.animated.push({ type: "shader", material: sea.material });
      const arches = [];
      for (let i = 0; i < 12; i++) {
        const p = t.at((i / 12) * t.length, t.halfWidth + 30);
        arches.push({
          p: [p.x, p.y - 12, p.z],
          s: [12, 20, 12],
          r: [0, i, 0],
          c: i % 2 ? "#c6a07c" : "#b9a27d",
        });
      }
      this.instances(
        new T.DodecahedronGeometry(1),
        this.mat("#ffffff"),
        arches,
      );
      for (let i = 0; i < 4; i++) {
        const p = t.at(((i + 0.2) / 4) * t.length);
        const balloon = this.mesh(
          new T.SphereGeometry(7, 16, 16),
          this.mat(["#e6a57c", "#7fc5c5", "#b8a8d6", "#e6c87e"][i]),
          p.x + 65,
          p.y + 65,
          p.z + 50,
        );
        balloon.scale.y = 1.25;
        this.animated.push({
          type: "float",
          mesh: balloon,
          y: balloon.position.y,
          phase: i,
        });
        this.box(
          2,
          1.7,
          2,
          "#8e6d62",
          balloon.position.x,
          balloon.position.y - 11,
          balloon.position.z,
        );
      }
    }
    if (t.theme === "lava") {
      const lavaMat = new T.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader:
          "varying vec2 uv0;void main(){uv0=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader:
          "varying vec2 uv0;uniform float time;void main(){vec2 p=uv0*90.;float n=sin(p.x+sin(p.y*1.7+time*.2)*2.)*sin(p.y+sin(p.x*1.3-time*.12)*2.);float crust=smoothstep(.05,.26,abs(n));vec3 c=mix(vec3(3.,.8,.07),vec3(.16,.035,.025),crust);gl_FragColor=vec4(c,1.);}",
        side: T.DoubleSide,
      });
      const lava = this.mesh(
        new T.PlaneGeometry(2200, 2200),
        lavaMat,
        0,
        -25,
        0,
      );
      lava.rotation.x = -Math.PI / 2;
      this.animated.push({ type: "shader", material: lavaMat });
      for (let i = 0; i < 7; i++) {
        const p = t.at((i / 7) * t.length, 45);
        const light = new T.PointLight("#ff5c1a", 160, 85, 2);
        light.position.set(p.x, p.y - 8, p.z);
        this.level.add(light);
      }
    }
    if (t.theme === "city" || t.theme === "lava" || t.theme === "snow")
      this.buildAtmosphere();
    if (t.theme === "city")
      for (const side of [-1, 1])
        this.ribbon(
          side * (t.halfWidth - 0.15),
          side * (t.halfWidth - 0.04),
          this.mat("#8effff", { emissive: "#39e8ff", emissiveIntensity: 2.5 }),
          0.03,
        );
  }
  buildCity(noise) {
    const T = this.T,
      t = this.track,
      buildings = [];
    const tex = this.texture(
      (ctx, w, h) => {
        ctx.fillStyle = "#141e36";
        ctx.fillRect(0, 0, w, h);
        for (let row = 0; row < 26; row++)
          for (let col = 0; col < 10; col++) {
            const x = (col * w) / 10 + 24,
              y = (row * h) / 26 + 12,
              on = noise(col + row * 83) > 0.32;
            ctx.fillStyle = on
              ? noise(col * 13 + row * 7) > 0.6
                ? "#d77bab"
                : "#71bacb"
              : "#1e2b45";
            ctx.fillRect(x, y, w / 10 - 43, h / 26 - 26);
            if (on) {
              ctx.fillStyle = "#c3ddea88";
              ctx.fillRect(x, y + 2, w / 10 - 43, 3);
            }
          }
        for (let i = 0; i <= 10; i++) {
          ctx.fillStyle = "#344057";
          ctx.fillRect((i * w) / 10, 0, 5, h);
        }
      },
      2048,
      2048,
    );
    for (let i = 0; i < 600; i++) {
      const x = (noise(i + 1) - 0.5) * 850,
        z = (noise(i + 500) - 0.5) * 850,
        p = projectTrack(t, x, 15, z);
      if (
        Math.min(p.distance, projectTrack(t, x, 40, z).distance) <
        t.supportWidth + 14
      )
        continue;
      const height = 18 + Math.pow(noise(i + 180), 1.4) * 135;
      buildings.push({
        p: [x, height / 2 - 45, z],
        s: [12 + noise(i + 60) * 18, height, 12 + noise(i + 80) * 18],
        c: ["#718aaa", "#776d9b", "#85a5b5"][i % 3],
      });
    }
    this.instances(
      new T.BoxGeometry(1, 1, 1),
      new T.MeshStandardMaterial({
        map: tex,
        color: "#a9baca",
        emissiveMap: tex,
        emissive: "#b0eaff",
        emissiveIntensity: 2.1,
        metalness: 0.5,
        roughness: 0.35,
      }),
      buildings,
    );
    for (let i = 0; i < 12; i++) {
      const p = t.at(((i + 0.4) / 12) * t.length, t.halfWidth + 8);
      this.sign(
        p,
        ["MIDNIGHT", "OVERDRIVE", "KART CLUB", "APEX / 24"][i % 4],
        i % 2 ? "#ea76da" : "#72f9ef",
        15,
        4.5,
      );
    }
    for (let i = 0; i < 8; i++) {
      const p = t.at((i / 8) * t.length);
      const ring = this.mesh(
        new T.TorusGeometry(t.halfWidth + 4, 0.19, 8, 64),
        this.mat("#8affff", { emissive: "#4ff5ed", emissiveIntensity: 3 }),
        p.x,
        p.y + 5,
        p.z,
      );
      ring.rotation.y = p.heading;
      this.animated.push({ type: "pulse", material: ring.material, phase: i });
    }
    this.mesh(
      new T.PlaneGeometry(2000, 2000),
      this.mat("#080e23", { metalness: 0.7, roughness: 0.35 }),
      0,
      -45,
      0,
    ).rotation.x = -Math.PI / 2;
  }
  buildAtmosphere() {
    const T = this.T,
      positions = [],
      t = this.track;
    for (let i = 0; i < 1000; i++) {
      positions.push(
        Math.sin(i * 18.3) * 420,
        Math.abs(Math.sin(i * 7.12)) * 180 - 10,
        Math.cos(i * 33.8) * 420,
      );
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    const mat = new T.PointsMaterial({
      color:
        t.theme === "lava"
          ? "#ff9a40"
          : t.theme === "city"
            ? "#729dc9"
            : "#e1f8ff",
      size: t.theme === "lava" ? 0.35 : t.theme === "city" ? 0.12 : 0.34,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    this.weather = new T.Points(g, mat);
    this.level.add(this.weather);
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
      this.roundedGeo(1.55, 0.45, 2.65, 0.16),
      paint,
      0,
      0.48,
      0,
      kart,
    );
    chassis.castShadow = true;
    this.mesh(
      this.roundedGeo(1.35, 0.26, 1.1, 0.1),
      paint,
      0,
      0.65,
      1.15,
      kart,
    );
    this.box(1.95, 0.14, 0.2, "#343c4b", 0, 0.34, 1.72, kart);
    this.box(1.95, 0.14, 0.2, "#343c4b", 0, 0.38, -1.43, kart);
    this.box(1.8, 0.16, 0.55, color, 0, 1.02, -1.28, kart);
    this.box(0.78, 0.85, 0.48, "#343c4b", 0, 1.03, -0.3, kart);
    const tireGeo = new T.CylinderGeometry(0.39, 0.39, 0.35, 32);
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
      new T.SphereGeometry(0.46, 32, 24),
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
    this.level.add(kart);
    return kart;
  }
  buildCockpit() {
    const T = this.T;
    this.cockpit = new T.Group();
    this.camera.add(this.cockpit);
    this.nose = this.mesh(
      this.roundedGeo(0.85, 0.18, 1.5, 0.08),
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
  buildParticles() {
    const T = this.T;
    this.particlePositions = new Float32Array(360 * 3);
    this.particleColors = new Float32Array(360 * 3);
    const g = new T.BufferGeometry();
    g.setAttribute(
      "position",
      new T.BufferAttribute(this.particlePositions, 3),
    );
    g.setAttribute("color", new T.BufferAttribute(this.particleColors, 3));
    this.particleMesh = new T.Points(
      g,
      new T.PointsMaterial({
        size: 0.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.particleMesh.frustumCulled = false;
    this.level.add(this.particleMesh);
  }
  emitParticle(p, boosting) {
    const side = Math.random() > 0.5 ? 1 : -1;
    this.particles.push({
      x: p.x - Math.cos(p.yaw) * side * 0.9,
      y: p.y + 0.3,
      z: p.z + Math.sin(p.yaw) * side * 0.9,
      vx: -p.vx * 0.12 + (Math.random() - 0.5) * 3,
      vy: Math.random() * 3,
      vz: -p.vz * 0.12 + (Math.random() - 0.5) * 3,
      life: 0.3 + Math.random() * 0.5,
      color: boosting || p.drift > 1.8 ? [0.3, 1, 1] : [1, 0.55, 0.1],
    });
    if (this.particles.length > 360) this.particles.shift();
  }
  setMode(mode, color = COLORS[0]) {
    this.mode = mode;
    this.cameraReady = false;
    this.cockpit.visible = mode === "race";
    this.nose.material.color.set(color);
  }
  update(race, myId, input, dt, time) {
    const T = this.T,
      racing = this.mode === "race",
      me = race?.players.find((p) => p.id === myId),
      t = this.track;
    if (race && racing && race.trackId !== t.id) {
      this.setTrack(race.trackId);
      return;
    }
    const demo = [
      {
        id: "showroom",
        name: "",
        color: this.color || COLORS[0],
        s: t.length * 0.04,
        offset: -2.5,
      },
      ...COLORS.slice(1, 4).map((color, i) => ({
        id: `demo-${i}`,
        name: "",
        color,
        s: t.length * (0.25 + i * 0.2) + time * (15 + i),
        offset: Math.sin(time * 0.2 + i) * 2,
      })),
    ].map((p) => {
      const at = t.at(p.s, p.offset);
      return {
        ...p,
        x: at.x,
        y: at.y,
        z: at.z,
        yaw: at.heading,
        bank: at.bank,
        slope: at.slope,
        speed: 0,
        steer: 0,
      };
    });
    const players = racing && race ? race.players : demo,
      visible = new Set();
    for (const p of players) {
      visible.add(p.id);
      let kart = this.karts.get(p.id);
      if (!kart) {
        kart = this.makeKart(p.color, racing && p.id !== myId ? p.name : "");
        this.karts.set(p.id, kart);
      }
      kart.visible = !(racing && p.id === myId);
      kart.scale.setScalar(p.id === "showroom" ? 1.9 : 1);
      kart.userData.paint.color.set(p.color);
      const teleport =
        kart.userData.respawns !== p.respawns || !kart.userData.initialized;
      const pos = new T.Vector3(p.x, p.y, p.z);
      if (teleport || !racing) kart.position.copy(pos);
      else kart.position.lerp(pos, Math.min(1, dt * 20));
      kart.userData.initialized = true;
      kart.userData.respawns = p.respawns;
      kart.rotation.set(
        p.falling ? Math.sin(time * 3) * 0.13 : -Math.atan(p.slope || 0),
        p.yaw,
        -(p.bank || 0) - (p.steer || 0) * 0.025,
      );
      if (p.invulnerable > 0) kart.visible &&= Math.sin(time * 25) > -0.3;
      if (racing && !p.falling && (p.drift > 0.1 || p.boosting > 0))
        this.emitParticle(p, p.boosting > 0);
    }
    for (const [id, kart] of this.karts)
      if (!visible.has(id)) kart.visible = false;
    this.crates.forEach((b, i) => {
      b.group.rotation.y = time * 1.15 + i;
      b.group.position.y = b.y + Math.sin(time * 2 + i) * 0.25;
      b.group.scale.setScalar(
        !racing || !me || (me.boxTimers[i] || 0) < race.clock ? 1 : 0.15,
      );
    });
    const alive = new Set();
    for (const h of racing && race ? race.hazards : []) {
      alive.add(h.id);
      let m = this.hazardMeshes.get(h.id);
      if (!m) {
        m = this.makeHazard(h.type);
        this.level.add(m);
        this.hazardMeshes.set(h.id, m);
      }
      m.position.set(h.x, h.y, h.z);
      m.rotation.y = time * (h.type === "banana" ? 0.5 : 9);
    }
    for (const [id, m] of this.hazardMeshes)
      if (!alive.has(id)) {
        this.level.remove(m);
        m.traverse((o) => o.geometry?.dispose());
        this.hazardMeshes.delete(id);
      }
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
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
    for (const a of this.animated) {
      if (a.type === "shader") a.material.uniforms.time.value = time;
      else if (a.type === "float")
        a.mesh.position.y = a.y + Math.sin(time * 0.3 + a.phase) * 2;
      else if (a.type === "pulse")
        a.material.emissiveIntensity =
          2.5 + Math.sin(time * 1.5 + a.phase) * 0.5;
    }
    if (this.weather) {
      this.weather.rotation.y = time * 0.012;
      this.weather.position.y =
        t.theme === "lava"
          ? (time * 2) % 40
          : t.theme === "snow"
            ? -(time * 2) % 40
            : -(time * 12) % 50;
    }
    let shadowAt;
    if (racing && me) {
      const pos = new T.Vector3(
        me.x,
        me.y +
          1.35 +
          (me.grounded && me.speed > 4 ? Math.sin(time * 32) * 0.009 : 0),
        me.z,
      );
      const teleport = !this.cameraReady || this.cameraRespawns !== me.respawns;
      if (teleport) this.camera.position.copy(pos);
      else this.camera.position.lerp(pos, Math.min(1, dt * 22));
      this.cameraRespawns = me.respawns;
      const roadHeading = t.at(me.trackS).heading;
      const targetPitch = me.falling
        ? -0.16
        : Math.atan(me.slope || 0) * Math.cos(angleDelta(me.yaw - roadHeading));
      this.pitch = teleport
        ? targetPitch
        : (this.pitch || 0) +
          (targetPitch - (this.pitch || 0)) * Math.min(1, dt * 8);
      this.camYaw = teleport
        ? me.yaw
        : (this.camYaw || 0) +
          angleDelta(me.yaw - (this.camYaw || 0)) * Math.min(1, dt * 25);
      // Le regard suit le cap libre du kart, jamais un point futur sur le circuit.
      this.camera.quaternion.setFromEuler(
        new T.Euler(
          this.pitch,
          this.camYaw + Math.PI,
          -(me.bank || 0) * 0.65 - input.steer * 0.018,
          "YXZ",
        ),
      );
      this.camera.fov +=
        ((me.boosting > 0 ? 84 : 73) - this.camera.fov) * Math.min(1, dt * 5);
      this.wheel.rotation.z +=
        (-input.steer * 0.9 - this.wheel.rotation.z) * Math.min(1, dt * 14);
      this.cockpit.rotation.z = me.stun > 0 ? Math.sin(time * 16) * 0.07 : 0;
      shadowAt = me;
      this.boostLight.intensity = me.boosting > 0 ? 4 : 0;
    } else {
      const at = t.at(t.length * 0.04);
      this.camera.position.set(
        at.x + at.tx * 22 - at.tz * 29,
        at.y + 12 + Math.sin(time * 0.06),
        at.z + at.tz * 22 + at.tx * 29,
      );
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(at.x + at.tx * 1, at.y + 2, at.z + at.tz * 1);
      this.camera.fov = 58;
      shadowAt = at;
      this.boostLight.intensity = 0;
    }
    const sx = Math.round(shadowAt.x / 8) * 8,
      sz = Math.round(shadowAt.z / 8) * 8;
    this.sun.position.set(sx - 55, shadowAt.y + 95, sz + 45);
    this.sun.target.position.set(sx, shadowAt.y, sz);
    this.sun.target.updateMatrixWorld();
    this.cameraReady = true;
    this.camera.updateProjectionMatrix();
    this.post.render(this.scene, this.camera);
  }
}
export function drawMap(
  canvas,
  players = [],
  myId = "",
  dark = false,
  trackId = "sunset",
) {
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height,
    t = getTrack(trackId),
    b = t.bounds;
  ctx.clearRect(0, 0, w, h);
  const scale = Math.min(
    (w - 30) / (b.maxX - b.minX),
    (h - 25) / (b.maxZ - b.minZ),
  );
  const map = (p) => [
    w / 2 + (p.x - (b.minX + b.maxX) / 2) * scale,
    h / 2 + (p.z - (b.minZ + b.maxZ) / 2) * scale,
  ];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [lineWidth, strokeStyle] of [
    [dark ? 11 : 8, dark ? "#ffffff18" : "#d1d9d0"],
    [dark ? 3 : 2.8, dark ? "#e4edf5" : "#566b68"],
  ]) {
    ctx.beginPath();
    for (let i = 0; i <= 500; i++) {
      const p = map(t.at((i / 500) * t.length));
      if (!i) ctx.moveTo(...p);
      else ctx.lineTo(...p);
    }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
  const start = map(t.at(0));
  ctx.fillStyle = t.accent;
  ctx.fillRect(start[0] - 3, start[1] - 4, 6, 8);
  for (const p of [...players].sort(
    (a, b) => (a.id === myId) - (b.id === myId),
  )) {
    const pos = map(p.x !== undefined ? p : t.at(p.s, p.offset));
    ctx.beginPath();
    ctx.arc(...pos, p.id === myId ? 5 : 3.5, 0, TAU);
    ctx.fillStyle = p.falling ? "#ff6b5c" : p.color;
    ctx.fill();
    ctx.lineWidth = p.id === myId ? 2 : 1;
    ctx.strokeStyle = p.id === myId ? "#ffffff" : "#242a38";
    ctx.stroke();
  }
}
