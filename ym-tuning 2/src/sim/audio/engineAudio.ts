/**
 * Simulated engine sound — Web Audio synthesis driven by the simulator snapshot.
 *
 * Follows the YM ENGINE LAB approach (firing-frequency oscillators, load-dependent filter,
 * intake noise, turbo whistle). The class implements `EngineSoundEngine`, so the original
 * YM ENGINE LAB audio module can be dropped in by implementing the same interface.
 *
 * Audio is created only inside `start()`, which the UI calls from an explicit user gesture.
 */

export interface EngineSoundInput {
  rpm: number;
  /** delivered torque fraction 0..1 */
  load: number;
  throttle: number;
  limiterCut: boolean;
  shifting: boolean;
  /** 0..1 turbo activity (0 for naturally aspirated) */
  boost: number;
}

export interface EngineSoundEngine {
  readonly running: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  update(i: EngineSoundInput): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
}

/** Deterministic noise (xorshift) so even the audio texture is reproducible. */
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let x = 0x2f6b9e1d;
  for (let i = 0; i < d.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    d[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buf;
}

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * (1 + amount * 6)) / Math.tanh(1 + amount * 6);
  }
  return c;
}

export class WebAudioEngineSound implements EngineSoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private body!: GainNode;
  private filter!: BiquadFilterNode;
  private shaper!: WaveShaperNode;
  private oscFire!: OscillatorNode;
  private oscSub!: OscillatorNode;
  private oscHarm!: OscillatorNode;
  private intakeGain!: GainNode;
  private intakeFilter!: BiquadFilterNode;
  private whistle!: OscillatorNode;
  private whistleGain!: GainNode;
  private volume = 0.6;
  private muted = false;
  private lastDrive = -1;

  constructor(private readonly cylinders: number) {}

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  async start(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const Ctx: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(ctx.destination);

    this.body = ctx.createGain();
    this.body.gain.value = 0.25;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;
    this.body.connect(this.shaper).connect(this.filter).connect(this.master);

    const osc = (type: OscillatorType, gain: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.body);
      o.start();
      return o;
    };
    this.oscFire = osc('sawtooth', 0.55);
    this.oscSub = osc('square', 0.3);
    this.oscHarm = osc('sawtooth', 0.18);
    this.oscHarm.detune.value = 7;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 2);
    noise.loop = true;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 0.8;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    noise.connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);
    noise.start();

    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain).connect(this.master);
    this.whistle.start();

    this.applyVolume();
  }

  async stop(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) await ctx.close().catch(() => undefined);
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyVolume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.ctx) return;
    const target = this.muted ? 0 : this.volume * 0.7;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  update(i: EngineSoundInput): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const k = 0.03; // smoothing time constant
    const fire = (i.rpm / 60) * (this.cylinders / 2);
    this.oscFire.frequency.setTargetAtTime(fire, now, k);
    this.oscSub.frequency.setTargetAtTime(fire / 2, now, k);
    this.oscHarm.frequency.setTargetAtTime(fire * 2, now, k);

    const load = i.shifting ? 0.1 : i.load;
    const cut = i.limiterCut ? 0.35 : 1;
    this.body.gain.setTargetAtTime((0.12 + 0.35 * load) * cut, now, i.limiterCut ? 0.005 : k);
    this.filter.frequency.setTargetAtTime(250 + load * 2600 + i.rpm * 0.35, now, k);

    const drive = Math.round(load * 10) / 10;
    if (drive !== this.lastDrive) {
      this.shaper.curve = driveCurve(drive);
      this.lastDrive = drive;
    }

    this.intakeFilter.frequency.setTargetAtTime(400 + i.rpm * 0.5, now, k);
    this.intakeGain.gain.setTargetAtTime(0.04 * i.throttle * (i.rpm / 7000), now, k);

    this.whistle.frequency.setTargetAtTime(1800 + i.boost * 4200, now, 0.08);
    this.whistleGain.gain.setTargetAtTime(0.018 * i.boost * i.boost, now, 0.1);
  }
}
