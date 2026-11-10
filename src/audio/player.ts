import { Timeline } from '../model/timeline';
import { Piano } from './piano';

/** 提前多少秒把音符交给声卡排队 */
const LOOKAHEAD = 0.18;
const TICK_MS = 25;
const EPS = 1e-6;

interface Anchor {
  /** AudioContext 时刻 */
  time: number;
  /** 这一刻对应的“原速秒数” */
  sec: number;
  /** 这一轮从哪里开始，预备拍期间光标停在这里 */
  startBeat: number;
}

interface Preroll {
  t0: number;
  interval: number;
  count: number;
  perBar: number;
}

export class Player {
  timeline?: Timeline;
  playing = false;
  loop = false;
  countIn = true;
  metronome = false;
  /** 静音的谱表（这只手由我自己弹） */
  readonly muted = new Set<number>();
  /** 播放、暂停、结束、位置跳转时通知界面 */
  onChange?: () => void;

  private factor = 1;
  private pos = 0;
  private anchor: Anchor = { time: 0, sec: 0, startBeat: 0 };
  /** 循环回头时，上一轮还没响完的这一小段时间里，界面仍按上一轮的时钟走 */
  private prev?: { anchor: Anchor; until: number };
  private preroll?: Preroll;
  private nextNote = 0;
  private nextClick = 0;
  private endTime?: number;
  private timer?: number;

  constructor(readonly piano: Piano) {}

  setTimeline(tl: Timeline | undefined, beat = 0): void {
    this.halt();
    this.timeline = tl;
    this.pos = tl ? Math.min(Math.max(0, beat), tl.total) : 0;
    this.onChange?.();
  }

  get tempoFactor(): number {
    return this.factor;
  }

  set tempoFactor(f: number) {
    if (this.playing) {
      // 以当前时刻为新的基准，之后按新速度走
      const now = this.piano.ctx.currentTime;
      this.anchor = { ...this.anchor, sec: this.anchor.sec + (now - this.anchor.time) * this.factor, time: now };
    }
    this.factor = f;
  }

  /** 当前位置，单位是四分音符 */
  get beat(): number {
    const tl = this.timeline;
    if (!tl) return 0;
    if (!this.playing) return this.pos;
    const ctx = this.piano.ctx;
    const now = ctx.currentTime - (ctx.outputLatency || 0);
    const a = this.prev && now < this.prev.until ? this.prev.anchor : this.anchor;
    const b = tl.beatAt(a.sec + (now - a.time) * this.factor);
    return Math.min(Math.max(b, a.startBeat), tl.total);
  }

  /** 预备拍期间返回正在数第几拍，否则返回 0 */
  get countInBeat(): number {
    const p = this.preroll;
    if (!this.playing || !p) return 0;
    const now = this.piano.ctx.currentTime - (this.piano.ctx.outputLatency || 0);
    if (this.prev && now < this.prev.until) return 0;
    const k = Math.floor((now - p.t0) / p.interval);
    if (k < 0 || k >= p.count) return 0;
    return (k % p.perBar) + 1;
  }

  async play(): Promise<void> {
    const tl = this.timeline;
    if (!tl || this.playing || tl.total <= 0) return;
    await this.piano.resume();
    if (this.pos >= tl.total - EPS) this.pos = 0;
    this.playing = true;
    this.begin(this.piano.ctx.currentTime + 0.06, this.pos, this.countIn);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.onChange?.();
  }

  pause(): void {
    if (!this.playing) return;
    this.pos = this.beat;
    this.halt();
    this.onChange?.();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  /** 跳到指定位置。正在播放时从新位置接着播，不再数预备拍。 */
  seek(beat: number): void {
    const tl = this.timeline;
    if (!tl) return;
    const was = this.playing;
    this.halt();
    this.pos = Math.min(Math.max(0, beat), tl.total);
    if (was) {
      this.playing = true;
      this.begin(this.piano.ctx.currentTime + 0.04, this.pos, false);
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
      this.tick();
    }
    this.onChange?.();
  }

  /** 试听某个位置起音的那些音，用于逐拍步进 */
  async audition(beat: number): Promise<void> {
    const tl = this.timeline;
    if (!tl) return;
    await this.piano.resume();
    this.piano.stopAll();
    const t = this.piano.ctx.currentTime + 0.02;
    for (let i = tl.firstNoteAt(beat); i < tl.notes.length; i++) {
      const n = tl.notes[i];
      if (n.start > beat + EPS) break;
      if (this.muted.has(n.note.track)) continue;
      const dur = (tl.secAt(n.end) - tl.secAt(n.start)) / this.factor;
      this.piano.play(n.note.midi, t, Math.min(dur, 1.6), this.velocity(n.note.track, n.note.grace));
    }
  }

  private velocity(track: number, grace: boolean): number {
    if (grace) return 0.5;
    return track === 0 ? 0.74 : 0.6;
  }

  private halt(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.playing = false;
    this.preroll = undefined;
    this.prev = undefined;
    this.endTime = undefined;
    this.piano.stopAll();
  }

  /** 从 t0 时刻起，（数完预备拍后）从 beat 开始演奏 */
  private begin(t0: number, beat: number, withCountIn: boolean): void {
    const tl = this.timeline!;
    let start = t0;
    this.preroll = undefined;
    if (withCountIn) {
      const ci = tl.countIn(beat);
      const interval = (ci.beatLen * 60) / tl.bpmAt(beat) / this.factor;
      for (let k = 0; k < ci.count; k++) this.piano.click(t0 + k * interval, k % ci.perBar === 0);
      start = t0 + ci.count * interval;
      this.preroll = { t0, interval, count: ci.count, perBar: ci.perBar };
    }
    this.anchor = { time: start, sec: tl.secAt(beat), startBeat: beat };
    this.nextNote = tl.firstNoteAt(beat);
    this.nextClick = tl.firstClickAt(beat);
    this.endTime = undefined;
  }

  private tick(): void {
    const tl = this.timeline;
    if (!tl || !this.playing) return;
    const now = this.piano.ctx.currentTime;
    if (this.prev && now >= this.prev.until) this.prev = undefined;
    if (this.endTime !== undefined) {
      if (now >= this.endTime) {
        this.halt();
        this.pos = 0;
        this.onChange?.();
      }
      return;
    }

    const f = this.factor;
    const a = this.anchor;
    const timeOf = (beat: number): number => a.time + (tl.secAt(beat) - a.sec) / f;
    const horizon = Math.min(tl.beatAt(a.sec + (now + LOOKAHEAD - a.time) * f), tl.total);

    while (this.nextNote < tl.notes.length && tl.notes[this.nextNote].start < horizon) {
      const n = tl.notes[this.nextNote++];
      if (this.muted.has(n.note.track)) continue;
      const dur = (tl.secAt(n.soundEnd) - tl.secAt(n.start)) / f;
      this.piano.play(n.note.midi, timeOf(n.start), dur, this.velocity(n.note.track, n.note.grace));
    }
    while (this.nextClick < tl.clicks.length && tl.clicks[this.nextClick].beat < horizon) {
      const c = tl.clicks[this.nextClick++];
      if (this.metronome) this.piano.click(timeOf(c.beat), c.accent);
    }

    if (horizon >= tl.total - EPS) {
      const end = timeOf(tl.total);
      if (this.loop) {
        this.prev = { anchor: a, until: end };
        this.begin(end, 0, this.countIn);
      } else {
        this.endTime = end;
      }
    }
  }
}
