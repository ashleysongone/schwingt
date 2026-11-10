/**
 * 钢琴音色。用 Salamander Grand Piano 采样（每隔小三度一个），
 * 中间的音靠变速播放得到。采样没加载成功时退回合成音，保证总能出声。
 */

const SAMPLE_NAMES = [
  'A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3',
  'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5',
  'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8',
];
const NAME_SEMITONE: Record<string, number> = { C: 0, Ds: 3, Fs: 6, A: 9 };

function sampleMidi(name: string): number {
  const m = /^([A-G]s?)(\d)$/.exec(name)!;
  return (parseInt(m[2], 10) + 1) * 12 + NAME_SEMITONE[m[1]];
}

interface Voice {
  src: AudioScheduledSourceNode;
  extra?: AudioScheduledSourceNode;
  gain: GainNode;
  start: number;
  stop: number;
}

export class Piano {
  readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly sampled: number[] = [];
  private readonly voices = new Set<Voice>();
  loaded = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(comp).connect(this.ctx.destination);
  }

  /** 浏览器要求先有用户操作才能出声，每次开始播放前调用 */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async load(baseUrl: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    let done = 0;
    await Promise.all(
      SAMPLE_NAMES.map(async (name) => {
        try {
          const res = await fetch(`${baseUrl}${name}.mp3`);
          if (!res.ok) throw new Error(String(res.status));
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(sampleMidi(name), buf);
        } catch (err) {
          console.warn(`钢琴采样 ${name} 加载失败`, err);
        }
        onProgress?.(++done, SAMPLE_NAMES.length);
      }),
    );
    this.sampled.length = 0;
    this.sampled.push(...Array.from(this.buffers.keys()).sort((a, b) => a - b));
    this.loaded = this.sampled.length > 0;
  }

  private nearestSample(midi: number): number | undefined {
    let best: number | undefined;
    for (const s of this.sampled) {
      if (best === undefined || Math.abs(s - midi) < Math.abs(best - midi)) best = s;
    }
    return best;
  }

  /**
   * 安排一个音。
   * @param when 开始时刻（AudioContext 时间）
   * @param dur 按住多久，秒
   * @param velocity 力度 0–1
   */
  play(midi: number, when: number, dur: number, velocity = 0.7): void {
    const ctx = this.ctx;
    const t0 = Math.max(when, ctx.currentTime);
    const off = t0 + Math.max(0.05, dur);
    const gain = ctx.createGain();
    gain.connect(this.out);
    const level = 0.15 + 0.85 * velocity * velocity;
    let voice: Voice;

    const sample = this.nearestSample(midi);
    if (sample !== undefined) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get(sample)!;
      src.playbackRate.value = Math.pow(2, (midi - sample) / 12);
      src.connect(gain);
      // 采样本身录得偏轻，这里补一点增益；总输出有压限器兜底
      gain.gain.setValueAtTime(level * 2, t0);
      gain.gain.setTargetAtTime(0, off, 0.09);
      src.start(t0);
      src.stop(off + 0.9);
      voice = { src, gain, start: t0, stop: off + 0.9 };
    } else {
      // 合成音：基频加一个泛音，带衰减
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = freq;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = freq * 2;
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      o1.connect(gain);
      o2.connect(g2).connect(gain);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(level * 0.5, t0 + 0.008);
      gain.gain.setTargetAtTime(level * 0.12, t0 + 0.008, 0.6);
      gain.gain.setTargetAtTime(0, off, 0.08);
      o1.start(t0);
      o2.start(t0);
      o1.stop(off + 0.8);
      o2.stop(off + 0.8);
      voice = { src: o1, extra: o2, gain, start: t0, stop: off + 0.8 };
    }

    this.voices.add(voice);
    voice.src.onended = () => {
      this.voices.delete(voice);
      gain.disconnect();
    };
  }

  /** 节拍器的一下 */
  click(when: number, accent: boolean): void {
    const ctx = this.ctx;
    const t0 = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1568 : 1047;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(accent ? 0.28 : 0.18, t0 + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    osc.connect(gain).connect(this.out);
    osc.start(t0);
    osc.stop(t0 + 0.08);
    const voice: Voice = { src: osc, gain, start: t0, stop: t0 + 0.08 };
    this.voices.add(voice);
    osc.onended = () => {
      this.voices.delete(voice);
      gain.disconnect();
    };
  }

  /** 立刻收掉所有正在响和已安排的音 */
  stopAll(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        if (v.start > now) {
          // 还没开始响的直接断开
          v.gain.disconnect();
        } else {
          v.gain.gain.setTargetAtTime(0, now, 0.03);
        }
        v.src.stop(now + 0.15);
        v.extra?.stop(now + 0.15);
      } catch {
        // 已经停止的节点再停会抛错，忽略
      }
    }
    this.voices.clear();
  }
}
