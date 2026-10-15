// Bloom HDR à résolution réduite et étalonnage final. Pas de dépendance aux
// addons/CDN : les passes utilisent la même instance Three.js que le jeu.
export class PostProcessing {
  constructor(T, renderer) {
    this.T = T;
    this.renderer = renderer;
    this.enabled = true;
    this.scene = new T.Scene();
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const vertexShader =
      "varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}";
    const material = (fragmentShader, uniforms) =>
      new T.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
    this.quad = new T.Mesh(new T.PlaneGeometry(2, 2));
    this.scene.add(this.quad);
    this.extract = material(
      "varying vec2 vUv;uniform sampler2D source;void main(){vec3 c=texture2D(source,vUv).rgb;float b=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(.8,1.7,b),1.);}",
      { source: { value: null } },
    );
    this.blur = material(
      "varying vec2 vUv;uniform sampler2D source;uniform vec2 direction;void main(){vec3 c=texture2D(source,vUv).rgb*.227027;c+=(texture2D(source,vUv+direction*1.384615).rgb+texture2D(source,vUv-direction*1.384615).rgb)*.316216;c+=(texture2D(source,vUv+direction*3.230769).rgb+texture2D(source,vUv-direction*3.230769).rgb)*.070270;gl_FragColor=vec4(c,1.);}",
      { source: { value: null }, direction: { value: new T.Vector2() } },
    );
    this.grade = material(
      `varying vec2 vUv;uniform sampler2D source;uniform sampler2D bloom;uniform float strength;uniform float exposure;uniform float saturation;uniform vec3 tint;
      vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
      vec3 srgb(vec3 x){return mix(x*12.92,1.055*pow(max(x,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),x));}
      void main(){vec3 c=(texture2D(source,vUv).rgb+texture2D(bloom,vUv).rgb*strength)*exposure*tint;float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,saturation);c=aces(c);vec2 uv=vUv-.5;c*=1.-dot(uv,uv)*.23;gl_FragColor=vec4(srgb(c),1.);}`,
      {
        source: { value: null },
        bloom: { value: null },
        strength: { value: 0.42 },
        exposure: { value: 1 },
        saturation: { value: 1.1 },
        tint: { value: new T.Vector3(1, 1, 1) },
      },
    );
    this.type = renderer.extensions.has("EXT_color_buffer_float")
      ? T.HalfFloatType
      : T.UnsignedByteType;
    this.main = this.a = this.b = null;
  }
  resize(width, height, ratio, quality) {
    this.enabled = quality !== "low";
    if (!this.enabled) {
      for (const target of [this.main, this.a, this.b]) target?.dispose();
      this.main = this.a = this.b = null;
      return;
    }
    if (!this.main) {
      this.main = new this.T.WebGLRenderTarget(1, 1, {
        type: this.type,
        depthBuffer: true,
      });
      this.a = new this.T.WebGLRenderTarget(1, 1, {
        type: this.type,
        depthBuffer: false,
      });
      this.b = this.a.clone();
    }
    const samples = quality === "high" ? 4 : 0;
    if (this.main.samples !== samples) {
      this.main.dispose();
      this.main.samples = samples;
    }
    this.main.setSize(Math.round(width * ratio), Math.round(height * ratio));
    this.a.setSize(
      Math.max(1, Math.round((width * ratio) / 4)),
      Math.max(1, Math.round((height * ratio) / 4)),
    );
    this.b.setSize(this.a.width, this.a.height);
    this.enabled = quality !== "low";
  }
  theme(track) {
    this.grade.uniforms.exposure.value = track.exposure;
    this.grade.uniforms.saturation.value = track.saturation;
    this.grade.uniforms.strength.value =
      track.theme === "city" ? 0.65 : track.theme === "lava" ? 0.5 : 0.28;
    this.grade.uniforms.tint.value.set(
      track.theme === "snow" ? 0.95 : 1.03,
      1,
      track.theme === "lava" ? 0.94 : 1.02,
    );
  }
  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }
  render(scene, camera) {
    const r = this.renderer,
      T = this.T;
    if (!this.enabled) {
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = this.grade.uniforms.exposure.value;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.toneMapping = T.NoToneMapping;
    r.setRenderTarget(this.main);
    r.render(scene, camera);
    this.extract.uniforms.source.value = this.main.texture;
    this.pass(this.extract, this.a);
    this.blur.uniforms.source.value = this.a.texture;
    this.blur.uniforms.direction.value.set(1 / this.a.width, 0);
    this.pass(this.blur, this.b);
    this.blur.uniforms.source.value = this.b.texture;
    this.blur.uniforms.direction.value.set(0, 1 / this.a.height);
    this.pass(this.blur, this.a);
    this.grade.uniforms.source.value = this.main.texture;
    this.grade.uniforms.bloom.value = this.a.texture;
    this.pass(this.grade, null);
  }
}
