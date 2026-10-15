export class AudioEngine {
  constructor() {
    this.enabled = false;
  }
  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) {
          this.enabled = false;
          return false;
        }
        this.context = new Context();
        this.engine = this.context.createOscillator();
        this.engine.type = "sawtooth";
        this.filter = this.context.createBiquadFilter();
        this.filter.type = "lowpass";
        this.filter.frequency.value = 210;
        this.gain = this.context.createGain();
        this.gain.gain.value = 0;
        this.engine
          .connect(this.filter)
          .connect(this.gain)
          .connect(this.context.destination);
        this.engine.start();
      }
      await this.context.resume();
    } else if (this.gain) this.gain.gain.value = 0;
    return this.enabled;
  }
  note(freq = 440, duration = 0.12, type = "sine", delay = 0) {
    if (!this.enabled || !this.context) return;
    const time = this.context.currentTime + delay,
      osc = this.context.createOscillator(),
      gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.045, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain).connect(this.context.destination);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }
  effect(type) {
    if (type === "pickup") {
      this.note(659);
      this.note(988, 0.2, "sine", 0.1);
    } else if (type === "hit") this.note(98, 0.4, "sawtooth");
    else if (type === "finish")
      [523, 659, 784, 1047].forEach((f, i) =>
        this.note(f, 0.26, "triangle", i * 0.13),
      );
    else if (["pad", "driftBoost", "item"].includes(type)) {
      this.note(330, 0.2, "triangle");
      this.note(660, 0.3, "triangle", 0.1);
    }
  }
  update(player, active) {
    if (!this.context || !this.enabled) return;
    const t = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(
      36 + (player?.speed || 0) * 2.6,
      t,
      0.08,
    );
    this.filter.frequency.setTargetAtTime(
      180 + (player?.speed || 0) * 8,
      t,
      0.1,
    );
    this.gain.gain.setTargetAtTime(active ? 0.018 : 0, t, 0.12);
  }
}
