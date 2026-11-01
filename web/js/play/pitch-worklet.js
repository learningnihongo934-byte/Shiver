// Granular pitch shifter: two read heads sweep through a delay line at a different speed than
// the write head, cross-faded so the seams don't click. Used for the demon and ghost voices.
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4 }];
  }
  constructor() {
    super();
    this.size = 4096;
    this.buf = new Float32Array(this.size);
    this.w = 0;
    this.phase = 0;
    this.win = 2048;
  }
  process(inputs, outputs, params) {
    const input = inputs[0][0];
    const out = outputs[0];
    if (!input) return true;
    const ratio = params.ratio[0];
    const N = this.size, win = this.win, buf = this.buf;
    for (let i = 0; i < input.length; i++) {
      buf[this.w] = input[i];
      this.phase = (this.phase + (1 - ratio) + win) % win;
      let s = 0;
      for (let k = 0; k < 2; k++) {
        const p = (this.phase + k * win * 0.5) % win;
        const fade = Math.sin((Math.PI * p) / win);
        let rp = this.w - p;
        if (rp < 0) rp += N;
        const i0 = Math.floor(rp), f = rp - i0;
        const a = buf[i0 % N], b = buf[(i0 + 1) % N];
        s += (a + (b - a) * f) * fade * fade;
      }
      for (const ch of out) ch[i] = s;
      this.w = (this.w + 1) % N;
    }
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifter);
