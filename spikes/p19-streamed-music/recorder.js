// AudioWorklet that watches its input for silence. A run of samples with |x| < 0.01 longer than
// a sine at 440 Hz can produce (a few samples near a zero crossing) is a gap.
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.run = 0; this.maxRun = 0; this.gaps = 0; this.frames = 0; this.sumSq = 0; this.n = 0; this.armed = false;
    this.port.onmessage = e => {
      if (e.data === "arm") { this.armed = true; this.maxRun = 0; this.gaps = 0; this.run = 0; }
      if (e.data === "read") { this.port.postMessage({ maxRun: this.maxRun, gaps: this.gaps, frames: this.frames, rms: Math.sqrt(this.sumSq / Math.max(1, this.n)) }); this.sumSq = 0; this.n = 0; }
    };
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      this.sumSq += x * x; this.n++;
      if (!this.armed) continue;
      if (Math.abs(x) < 0.01) { this.run++; } else {
        if (this.run > 32) this.gaps++;
        if (this.run > this.maxRun) this.maxRun = this.run;
        this.run = 0;
      }
    }
    this.frames += ch.length;
    return true;
  }
}
registerProcessor("recorder", Recorder);
