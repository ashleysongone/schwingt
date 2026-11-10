import { GRACE_DUR } from './musicxml';
import { unroll } from './sequence';
import { Measure, NoteEvent, Score } from './types';

export const DEFAULT_BPM = 100;
const EPS = 1e-6;

export interface Segment {
  /** 小节序号 */
  measure: number;
  /** 在演奏时间线上的起点，单位是四分音符 */
  start: number;
  dur: number;
}

export interface TimedNote {
  note: NoteEvent;
  start: number;
  /** 手指离键的时刻 */
  end: number;
  /** 算上延音踏板后，声音实际结束的时刻 */
  soundEnd: number;
}

export interface Click {
  beat: number;
  accent: boolean;
}

interface TempoPoint {
  beat: number;
  bpm: number;
  /** 原速下，从时间线开头到这里的秒数 */
  sec: number;
}

export interface CountIn {
  /** 预备拍一共敲几下 */
  count: number;
  /** 每一下的间隔，单位是四分音符 */
  beatLen: number;
  /** 每小节几下，用来决定哪一下是重音 */
  perBar: number;
}

/** 节拍器每一下的间隔。6/8、9/8、12/8 按附点四分音符敲。 */
export function clickLength(m: Measure): number {
  if (m.beatType === 8 && m.beats >= 6 && m.beats % 3 === 0) return 1.5;
  return 4 / m.beatType;
}

export class Timeline {
  segments: Segment[] = [];
  total = 0;
  notes: TimedNote[] = [];
  clicks: Click[] = [];
  /** 踏板踩下的区间 [踩下, 抬起) */
  pedals: [number, number][] = [];
  /** 所有音符起点，去重排序，用于逐拍步进 */
  steps: number[] = [];
  private tempos: TempoPoint[] = [];

  constructor(
    readonly score: Score,
    /** 只演奏这一段小节（含两端），不展开反复；不传则演奏全曲 */
    readonly region?: { from: number; to: number },
  ) {
    this.build();
  }

  private build(): void {
    const { measures, notes } = this.score;
    let order: number[];
    if (this.region) {
      const from = Math.max(0, Math.min(this.region.from, this.region.to));
      const to = Math.min(measures.length - 1, Math.max(this.region.from, this.region.to));
      order = [];
      for (let i = from; i <= to; i++) order.push(i);
    } else {
      order = unroll(measures);
    }

    let beat = 0;
    for (const index of order) {
      const dur = measures[index].duration;
      this.segments.push({ measure: index, start: beat, dur });
      beat += dur;
    }
    this.total = beat;

    // 每小节开头生效的速度，按谱面书写顺序算
    const tempoAtStart: number[] = [];
    let cur = DEFAULT_BPM;
    for (const m of measures) {
      tempoAtStart.push(cur);
      for (const t of m.tempos) cur = t.bpm;
    }

    const byMeasure: NoteEvent[][] = measures.map(() => []);
    for (const n of notes) byMeasure[n.measure].push(n);

    const tempoRaw: { beat: number; bpm: number }[] = [];
    const pushTempo = (b: number, bpm: number): void => {
      const last = tempoRaw[tempoRaw.length - 1];
      if (last && Math.abs(last.beat - b) < EPS) last.bpm = bpm;
      else tempoRaw.push({ beat: b, bpm });
    };
    const pedalEvents: { beat: number; type: string }[] = [];
    const stepSet = new Set<number>();

    this.segments.forEach((seg, k) => {
      const m = measures[seg.measure];
      if (k === 0 || order[k - 1] !== seg.measure - 1) pushTempo(seg.start, tempoAtStart[seg.measure]);
      for (const t of m.tempos) pushTempo(seg.start + Math.min(t.offset, seg.dur), t.bpm);
      for (const p of m.pedals) pedalEvents.push({ beat: seg.start + Math.min(p.offset, seg.dur), type: p.type });

      const list = byMeasure[seg.measure];
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        let start = seg.start + n.start;
        if (n.grace) {
          // 连续的装饰音依次排在主音之前
          let after = 0;
          for (let j = i + 1; j < list.length; j++) {
            const x = list[j];
            if (x.grace && x.track === n.track && Math.abs(x.start - n.start) < EPS) after++;
            else break;
          }
          start = Math.max(0, start - GRACE_DUR * (after + 1));
        } else {
          stepSet.add(Math.round(start * 1e6) / 1e6);
        }
        const end = Math.min(start + n.dur, this.total);
        this.notes.push({ note: n, start, end, soundEnd: end });
      }

      const len = clickLength(m);
      if (m.implicit && seg.dur < m.nominal - EPS) {
        // 弱起小节：拍点向小节末尾对齐
        const pts: number[] = [];
        for (let j = 1; seg.dur - j * len > -EPS; j++) pts.push(Math.max(0, seg.dur - j * len));
        for (const p of pts.reverse()) this.clicks.push({ beat: seg.start + p, accent: false });
      } else {
        for (let j = 0; j * len < seg.dur - EPS; j++) {
          this.clicks.push({ beat: seg.start + j * len, accent: j === 0 });
        }
      }
    });

    this.notes.sort((a, b) => a.start - b.start || a.note.track - b.note.track || a.note.midi - b.note.midi);
    this.steps = Array.from(stepSet).sort((a, b) => a - b);

    let sec = 0;
    tempoRaw.forEach((t, i) => {
      if (i > 0) {
        const prev = tempoRaw[i - 1];
        sec += ((t.beat - prev.beat) * 60) / prev.bpm;
      }
      this.tempos.push({ beat: t.beat, bpm: t.bpm, sec });
    });
    if (!this.tempos.length) this.tempos.push({ beat: 0, bpm: DEFAULT_BPM, sec: 0 });

    let down: number | undefined;
    for (const e of pedalEvents) {
      if (e.type === 'start') {
        if (down === undefined) down = e.beat;
      } else {
        if (down !== undefined && e.beat > down + EPS) this.pedals.push([down, e.beat]);
        down = e.type === 'change' ? e.beat : undefined;
      }
    }
    if (down !== undefined && this.total > down + EPS) this.pedals.push([down, this.total]);

    if (this.pedals.length) {
      for (const tn of this.notes) {
        const p = this.pedalAt(tn.end);
        if (p) tn.soundEnd = Math.max(tn.end, p[1]);
      }
    }
  }

  /** 这一刻踏板是否踩着；恰好在踩下或抬起的瞬间不算 */
  private pedalAt(beat: number): [number, number] | undefined {
    let lo = 0;
    let hi = this.pedals.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const p = this.pedals[mid];
      if (beat <= p[0] + EPS) hi = mid - 1;
      else if (beat >= p[1] - EPS) lo = mid + 1;
      else return p;
    }
    return undefined;
  }

  private tempoIndexByBeat(beat: number): number {
    let lo = 0;
    let hi = this.tempos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tempos[mid].beat <= beat + EPS) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 原速下，时间线位置对应的秒数 */
  secAt(beat: number): number {
    const t = this.tempos[this.tempoIndexByBeat(beat)];
    return t.sec + ((beat - t.beat) * 60) / t.bpm;
  }

  beatAt(sec: number): number {
    let lo = 0;
    let hi = this.tempos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tempos[mid].sec <= sec + 1e-9) lo = mid;
      else hi = mid - 1;
    }
    const t = this.tempos[lo];
    return t.beat + ((sec - t.sec) * t.bpm) / 60;
  }

  bpmAt(beat: number): number {
    return this.tempos[this.tempoIndexByBeat(beat)].bpm;
  }

  segmentIndexAt(beat: number): number {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid].start <= beat + EPS) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 时间线位置落在哪个小节的什么位置 */
  locate(beat: number): { measure: number; offset: number; segment: number } {
    const i = this.segmentIndexAt(beat);
    const seg = this.segments[i];
    return {
      measure: seg.measure,
      offset: Math.min(Math.max(0, beat - seg.start), seg.dur),
      segment: i,
    };
  }

  /** 某小节第一次出现的位置；这一段里没有则返回 undefined */
  beatOfMeasure(measure: number): number | undefined {
    return this.segments.find((s) => s.measure === measure)?.start;
  }

  /** 第一个起点不早于 beat 的音符的下标 */
  firstNoteAt(beat: number): number {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].start < beat - EPS) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  firstClickAt(beat: number): number {
    let lo = 0;
    let hi = this.clicks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.clicks[mid].beat < beat - EPS) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** 这一刻正在按着的音符 */
  activeAt(beat: number): TimedNote[] {
    const out: TimedNote[] = [];
    const end = this.firstNoteAt(beat + 2 * EPS);
    // 最长的音符也不会跨太多小节，往回找一段就够
    for (let i = end - 1; i >= 0; i--) {
      const n = this.notes[i];
      if (beat - n.start > 64) break;
      if (n.start <= beat + EPS && n.end > beat + EPS) out.push(n);
    }
    return out;
  }

  /** 从 beat 开始演奏前，预备拍怎么数 */
  countIn(beat: number): CountIn {
    const seg = this.segments[this.segmentIndexAt(beat)];
    const m = this.score.measures[seg.measure];
    const beatLen = clickLength(m);
    const perBar = Math.max(1, Math.round(m.nominal / beatLen));
    let count = perBar;
    const pickup = m.implicit && seg.dur < m.nominal - EPS;
    if (pickup && Math.abs(beat - seg.start) < EPS) {
      count += Math.max(0, Math.round((m.nominal - seg.dur) / beatLen));
    }
    return { count, beatLen, perBar };
  }

  nextStep(beat: number): number | undefined {
    return this.steps.find((s) => s > beat + EPS);
  }

  prevStep(beat: number): number | undefined {
    for (let i = this.steps.length - 1; i >= 0; i--) if (this.steps[i] < beat - EPS) return this.steps[i];
    return undefined;
  }
}
