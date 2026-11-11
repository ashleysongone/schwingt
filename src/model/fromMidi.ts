import type { MidiFile, MidiNote } from '../io/midi';
import { STEP_SEMITONE } from './types';

/**
 * 把 MIDI 转成两行谱表的 MusicXML，用来显示五线谱。
 *
 * MIDI 里只有“哪个键、什么时候按下、按多久”，没有记谱信息，所以这里做了几件近似的事：
 * - 节奏对齐到十六分音符
 * - 每只手只记一个声部：同时起音的音记成和弦，下一个音起来时前面的音在谱面上就结束
 *   （实际发声的长度另外保留，播放时不受影响）
 * - 调号没写或明显不对时，按用到的音推断
 */
export interface MidiConversion {
  xml: string;
  warnings: string[];
  /** 每个音实际按住多久（十六分音符数）。键是 "谱表:小节:小节内位置:音高" */
  durations: Map<string, number>;
  /** 每个音的相对力度，1 是这只手平常的力度。这只手的力度从头到尾都一样时不填。键同上 */
  levels: Map<string, number>;
}

interface QNote {
  /** 起点和终点，单位是十六分音符 */
  on: number;
  end: number;
  midi: number;
  hand: 0 | 1;
  /** MIDI 力度 1–127 */
  velocity: number;
}

type PedalMark = { offset: number; type: 'start' | 'change' | 'stop' };

interface MeasureInfo {
  start: number;
  len: number;
  beats: number;
  beatType: number;
}

interface Piece {
  /** 空数组表示休止符 */
  midis: number[];
  dur: number;
  tieStart: boolean;
  tieStop: boolean;
  wholeMeasure: boolean;
}

const RIGHT_HINT = /right|\brh\b|r\.h|右|treble|upper/i;
const LEFT_HINT = /left|\blh\b|l\.h|左|bass|lower/i;
const VALUES = [16, 12, 8, 6, 4, 3, 2, 1];
const TYPE: Record<number, [string, boolean]> = {
  16: ['whole', false],
  12: ['half', true],
  8: ['half', false],
  6: ['quarter', true],
  4: ['quarter', false],
  3: ['eighth', true],
  2: ['eighth', false],
  1: ['16th', false],
};
/** 五度圈上的音名顺序：F C G D A E B，再往后是升号，往前是降号 */
const FIFTH_LETTERS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/**
 * 在小节的 p 位置能不能写一个时值为 v 的音符（单位都是十六分音符）。
 * @param rest 这个音从 p 起还剩多长
 */
function fits(p: number, v: number, beat: number, rest: number): boolean {
  const inBeat = p % beat;
  if (inBeat !== 0) {
    // 常见的切分：后半拍起、正好一拍长的音照常写成四分音符，只要不盖住小节正中间
    if (beat === 4 && inBeat === 2 && v === 4 && rest === 4 && p % 8 === 2) return true;
    // 其余不在拍点上起的音不跨过下一拍，这样每一拍在谱面上都看得出来
    if (inBeat + v > beat) return false;
    if (p % 2 === 1) return v === 1 || (beat === 4 && inBeat === 1 && v <= 3);
    return v === 1 || v === 2 || v === 4;
  }
  switch (v) {
    case 16:
      return beat !== 6 && p % 16 === 0;
    case 12:
      return beat === 6 ? p % 12 === 0 : p % 16 === 0 || p % 16 === 4;
    case 8:
      return beat !== 6 && p % 4 === 0;
    case 6:
      return beat === 6 || p % 8 === 0;
    default:
      return true;
  }
}

/** 把一段时值拆成能写出来的音符，中间用连音线连 */
export function decompose(p: number, d: number, m: { beats: number; beatType: number }): number[] {
  const compound = m.beatType === 8 && m.beats >= 6 && m.beats % 3 === 0;
  const beat = compound ? 6 : Math.max(1, Math.round(16 / m.beatType));
  const out: number[] = [];
  while (d > 0) {
    const v = VALUES.find((x) => x <= d && fits(p, x, beat, d)) ?? 1;
    out.push(v);
    p += v;
    d -= v;
  }
  return out;
}

/**
 * 按调号给一个音高选写法，例如 G 大调里 66 写成 F♯。
 * 在五度圈上取离调号最近的十二个位置：调内七个音，再加上最常见的几个变化音
 * （降三级、降七级、升四级、升一级、升五级）。所以降 B 大调里的 66 写成 F♯ 而不是 G♭。
 */
export function spell(midi: number, fifths: number): { step: string; alter: number; octave: number } {
  const pc = midi % 12;
  let pos = fifths - 3;
  while ((((pos * 7) % 12) + 12) % 12 !== pc) pos++;
  const i = pos + 1;
  const step = FIFTH_LETTERS[((i % 7) + 7) % 7];
  const alter = Math.floor(i / 7);
  return { step, alter, octave: (midi - STEP_SEMITONE[step] - alter) / 12 - 1 };
}
const KEY_CHOICES = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];
/** 换一次调号的代价，相当于这么多个十六分音符的调外音。太小会在临时变化音上频繁换调号 */
const KEY_SWITCH_COST = 32;

/**
 * 逐小节决定调号，能跟上中途转调（比如最后一遍副歌升一个调）。
 * 每个小节的代价是调外音的总时值，换调号另有固定代价，取总代价最小的方案。
 */
function keysPerMeasure(notes: QNote[], measures: MeasureInfo[], start: number, fixedStart: boolean): number[] {
  const keys = [start, ...KEY_CHOICES.filter((k) => k !== start)];
  const outside = keys.map((f) => {
    const tonic = (((f * 7) % 12) + 12) % 12;
    const out = new Array<boolean>(12).fill(true);
    for (const s of MAJOR) out[(tonic + s) % 12] = false;
    return out;
  });
  const weight = measures.map(() => new Array<number>(12).fill(0));
  const sorted = [...notes].sort((a, b) => a.on - b.on);
  let mi = 0;
  for (const n of sorted) {
    while (mi + 1 < measures.length && measures[mi].start + measures[mi].len <= n.on) mi++;
    weight[mi][n.midi % 12] += Math.min(n.end - n.on, 16);
  }

  let prev: number[] = keys.map((_, k) => (fixedStart && k !== 0 ? KEY_SWITCH_COST : 0));
  const back: number[][] = [];
  for (let m = 0; m < measures.length; m++) {
    let bestPrev = 0;
    for (let k = 1; k < keys.length; k++) if (prev[k] < prev[bestPrev]) bestPrev = k;
    const cur: number[] = [];
    const from: number[] = [];
    for (let k = 0; k < keys.length; k++) {
      let cost = 0;
      for (let pc = 0; pc < 12; pc++) if (outside[k][pc]) cost += weight[m][pc];
      const stay = prev[k] <= prev[bestPrev] + KEY_SWITCH_COST;
      cur.push((stay ? prev[k] : prev[bestPrev] + KEY_SWITCH_COST) + cost);
      from.push(stay ? k : bestPrev);
    }
    back.push(from);
    prev = cur;
  }
  let k = 0;
  for (let i = 1; i < keys.length; i++) if (prev[i] < prev[k]) k = i;
  const result = new Array<number>(measures.length);
  for (let m = measures.length - 1; m >= 0; m--) {
    result[m] = keys[k];
    k = back[m][k];
  }
  return result;
}

function chooseKey(midi: MidiFile, notes: QNote[]): number {
  const weight = new Array<number>(12).fill(0);
  let total = 0;
  for (const n of notes) {
    weight[n.midi % 12] += n.end - n.on;
    total += n.end - n.on;
  }
  const fit = (fifths: number): number => {
    const tonic = (((fifths * 7) % 12) + 12) % 12;
    return MAJOR.reduce((a, s) => a + weight[(tonic + s) % 12], 0) / (total || 1);
  };
  let best = 0;
  // 从升降号少的开始比，分数一样时用简单的那个
  for (const f of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) if (fit(f) > fit(best) + 1e-9) best = f;
  const written = midi.keySigs[0];
  if (!written) return best;
  const f = Math.max(-7, Math.min(7, written.fifths));
  // 很多 MIDI 的调号只是默认的 C 大调，和实际用的音对不上时不采信
  if (f !== 0 || fit(0) >= 0.9 || fit(best) - fit(0) < 0.05) return f;
  return best;
}

function assignHands(src: MidiNote[], midi: MidiFile, q: (tick: number) => number, warnings: string[]): { notes: QNote[]; pooled: boolean } {
  const groupBy = (key: (n: MidiNote) => number): Map<number, MidiNote[]> => {
    const map = new Map<number, MidiNote[]>();
    for (const n of src) {
      let list = map.get(key(n));
      if (!list) map.set(key(n), (list = []));
      list.push(n);
    }
    return map;
  };
  let groups = Array.from(groupBy((n) => n.track));
  let nameOf = (key: number): string => midi.trackNames[key] ?? '';
  if (groups.length < 2) {
    const byChannel = Array.from(groupBy((n) => n.channel));
    if (byChannel.length >= 2) {
      groups = byChannel;
      nameOf = () => '';
    }
  }

  const notes: QNote[] = [];
  const add = (list: MidiNote[], hand: 0 | 1): void => {
    for (const n of list) {
      const on = q(n.tick);
      notes.push({ on, end: Math.max(on + 1, q(n.tick + n.dur)), midi: n.midi, hand, velocity: n.velocity });
    }
  };

  if (groups.length === 2) {
    const [a, b] = groups;
    const an = nameOf(a[0]);
    const bn = nameOf(b[0]);
    const mean = (l: MidiNote[]): number => l.reduce((s, n) => s + n.midi, 0) / l.length;
    let aRight: boolean;
    if ((RIGHT_HINT.test(an) && !RIGHT_HINT.test(bn)) || (LEFT_HINT.test(bn) && !LEFT_HINT.test(an))) aRight = true;
    else if ((RIGHT_HINT.test(bn) && !RIGHT_HINT.test(an)) || (LEFT_HINT.test(an) && !LEFT_HINT.test(bn))) aRight = false;
    else aRight = mean(a[1]) >= mean(b[1]);
    add(a[1], aRight ? 0 : 1);
    add(b[1], aRight ? 1 : 0);
    return { notes, pooled: false };
  }

  for (const [, list] of groups) add(list, 0);
  warnings.push(
    groups.length === 1
      ? '这份 MIDI 没有把左右手分开，已按音高自动分手，可能有分错的地方'
      : `这份 MIDI 有 ${groups.length} 条音轨，已合并后按音高自动分左右手，可能有分错的地方`,
  );
  return { notes, pooled: true };
}

/** 没有分手信息时，逐小节找左右手之间的空档来分 */
function splitByPitch(notes: QNote[], measures: MeasureInfo[]): void {
  let split = 60;
  let i = 0;
  const sorted = [...notes].sort((a, b) => a.on - b.on);
  for (const m of measures) {
    const inMeasure: QNote[] = [];
    while (i < sorted.length && sorted[i].on < m.start + m.len) inMeasure.push(sorted[i++]);
    const pitches = Array.from(new Set(inMeasure.map((n) => n.midi))).sort((a, b) => a - b);
    let bestDist = Infinity;
    let candidate: number | undefined;
    for (let k = 0; k + 1 < pitches.length; k++) {
      const gap = pitches[k + 1] - pitches[k];
      const mid = (pitches[k + 1] + pitches[k]) / 2;
      if (gap < 4 || mid < 48 || mid > 72) continue;
      // 离上一小节的分界最近的空档最可信
      const dist = Math.abs(mid - split);
      if (dist < bestDist) {
        bestDist = dist;
        candidate = pitches[k + 1];
      }
    }
    if (candidate !== undefined) split = candidate;
    for (const n of inMeasure) n.hand = n.midi >= split ? 0 : 1;
  }
}

function layoutStaff(notes: QNote[], measures: MeasureInfo[]): Piece[][] {
  const out: Piece[][] = measures.map(() => []);
  const sorted = [...notes].sort((a, b) => a.on - b.on || a.midi - b.midi);
  const chords: { on: number; end: number; midis: number[] }[] = [];
  for (const n of sorted) {
    const last = chords[chords.length - 1];
    if (last && last.on === n.on) {
      if (!last.midis.includes(n.midi)) last.midis.push(n.midi);
      last.end = Math.max(last.end, n.end);
    } else {
      chords.push({ on: n.on, end: n.end, midis: [n.midi] });
    }
  }
  chords.forEach((c, i) => {
    const next = i + 1 < chords.length ? chords[i + 1].on : Infinity;
    let end = Math.min(c.end, next);
    // MIDI 里的音常常只按到时值的九成多。离下一个音或下一拍只差一点时补齐，
    // 免得谱面上到处是零碎的小休止符
    const target = Math.min(next, Math.ceil(end / 4) * 4);
    const gap = target - end;
    if (gap > 0 && (gap <= 1 || (gap <= 2 && end - c.on >= 6))) end = target;
    c.end = end;
  });

  let mi = 0;
  const emit = (from: number, to: number, midis: number[]): void => {
    const pieces: { m: number; piece: Piece }[] = [];
    let pos = from;
    while (pos < to && mi < measures.length) {
      while (mi + 1 < measures.length && measures[mi].start + measures[mi].len <= pos) mi++;
      const m = measures[mi];
      const segEnd = Math.min(to, m.start + m.len);
      if (segEnd <= pos) break;
      if (!midis.length && pos === m.start && segEnd === m.start + m.len) {
        pieces.push({ m: mi, piece: { midis, dur: m.len, tieStart: false, tieStop: false, wholeMeasure: true } });
      } else {
        for (const v of decompose(pos - m.start, segEnd - pos, m)) {
          pieces.push({ m: mi, piece: { midis, dur: v, tieStart: false, tieStop: false, wholeMeasure: false } });
        }
      }
      pos = segEnd;
    }
    pieces.forEach(({ m, piece }, k) => {
      if (midis.length) {
        piece.tieStop = k > 0;
        piece.tieStart = k < pieces.length - 1;
      }
      out[m].push(piece);
    });
  };

  let t = 0;
  for (const c of chords) {
    if (c.on > t) emit(t, c.on, []);
    emit(c.on, c.end, c.midis);
    t = c.end;
  }
  const last = measures[measures.length - 1];
  if (t < last.start + last.len) emit(t, last.start + last.len, []);
  return out;
}

function pieceXml(piece: Piece, staff: number, voice: number, fifths: number): string {
  const [type, dot] = TYPE[piece.dur] ?? ['quarter', false];
  const tail =
    `<duration>${piece.dur}</duration>` +
    (piece.tieStop ? '<tie type="stop"/>' : '') +
    (piece.tieStart ? '<tie type="start"/>' : '') +
    `<voice>${voice}</voice>` +
    (piece.wholeMeasure ? '' : `<type>${type}</type>${dot ? '<dot/>' : ''}`) +
    `<staff>${staff}</staff>` +
    (piece.tieStop || piece.tieStart
      ? `<notations>${piece.tieStop ? '<tied type="stop"/>' : ''}${piece.tieStart ? '<tied type="start"/>' : ''}</notations>`
      : '');
  if (!piece.midis.length) {
    return `<note><rest${piece.wholeMeasure ? ' measure="yes"' : ''}/>${tail}</note>`;
  }
  return piece.midis
    .map((midi, k) => {
      const s = spell(midi, fifths);
      const pitch = `<pitch><step>${s.step}</step>${s.alter ? `<alter>${s.alter}</alter>` : ''}<octave>${s.octave}</octave></pitch>`;
      return `<note>${k > 0 ? '<chord/>' : ''}${pitch}${tail}</note>`;
    })
    .join('');
}

export function midiToMusicXml(midi: MidiFile, title: string, composer = ''): MidiConversion {
  const warnings: string[] = [];
  const src = midi.notes.filter((n) => n.channel !== 9);
  if (!src.length) throw new Error('这个 MIDI 里没有可以弹的音符');

  const grid = midi.ppq / 4;
  const q = (tick: number): number => Math.round(tick / grid);

  // 节奏对不对得上十六分音符的格子
  let off = 0;
  let triplets = 0;
  for (const n of src) {
    const x = n.tick / grid;
    const d = Math.abs(x - Math.round(x));
    off += d;
    const y = n.tick / (midi.ppq / 3);
    if (d > 0.2 && Math.abs(y - Math.round(y)) < 0.08) triplets++;
  }
  if (triplets / src.length > 0.08) {
    warnings.push('这份 MIDI 里有三连音，谱面按十六分音符近似，这些地方的节奏会有出入');
  } else if (off / src.length > 0.12) {
    warnings.push('这份 MIDI 像是真人弹奏录下来的，节拍对不齐，转出来的谱子会比较乱');
  }

  const { notes, pooled } = assignHands(src, midi, q, warnings);

  let lastEnd = 0;
  for (const n of notes) lastEnd = Math.max(lastEnd, n.end);
  const sigs = midi.timeSigs.map((s) => ({ at: q(s.tick), beats: s.beats, beatType: s.beatType }));
  if (!sigs.length || sigs[0].at > 0) sigs.unshift({ at: 0, beats: 4, beatType: 4 });
  const measures: MeasureInfo[] = [];
  for (let start = 0, si = 0; (start < lastEnd || !measures.length) && measures.length < 5000; ) {
    while (si + 1 < sigs.length && sigs[si + 1].at <= start) si++;
    const s = sigs[si];
    const len = Math.max(1, Math.round((s.beats * 16) / s.beatType));
    measures.push({ start, len, beats: s.beats, beatType: s.beatType });
    start += len;
  }
  const measureAt = (pos: number): number => {
    let lo = 0;
    let hi = measures.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measures[mid].start <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  if (pooled) splitByPitch(notes, measures);
  const baseKey = chooseKey(midi, notes);
  const keys = keysPerMeasure(notes, measures, baseKey, midi.keySigs.length > 0 && baseKey === midi.keySigs[0].fifths);

  const keyOf = (n: QNote): string => {
    const mi = measureAt(n.on);
    return `${n.hand}:${mi}:${n.on - measures[mi].start}:${n.midi}`;
  };
  const durations = new Map<string, number>();
  for (const n of notes) durations.set(keyOf(n), Math.max(durations.get(keyOf(n)) ?? 0, n.end - n.on));

  // 力度按每只手自己的中位数折成相对值：文件里的绝对数值高低不一，只取它的起伏
  const levels = new Map<string, number>();
  for (const hand of [0, 1]) {
    const list = notes.filter((n) => n.hand === hand);
    const sorted = list.map((n) => n.velocity).sort((a, b) => a - b);
    if (!sorted.length || sorted[0] === sorted[sorted.length - 1]) continue;
    const median = sorted[sorted.length >> 1] || 1;
    for (const n of list) {
      const level = Math.min(1.35, Math.max(0.6, n.velocity / median));
      levels.set(keyOf(n), Math.max(levels.get(keyOf(n)) ?? 0, level));
    }
  }

  const staffPieces = [0, 1].map((hand) =>
    layoutStaff(
      notes.filter((n) => n.hand === hand),
      measures,
    ),
  );

  // 速度变化、段落名和演奏提示按位置分到各小节
  const extras: string[][] = measures.map(() => []);
  const offsetXml = (pos: number, mi: number): string => {
    const o = pos - measures[mi].start;
    return o > 0 ? `<offset>${o}</offset>` : '';
  };
  const tempos = midi.tempos.length && q(midi.tempos[0].tick) <= 0 ? [...midi.tempos] : [{ tick: 0, bpm: 120 }, ...midi.tempos];
  const firstBpm = Math.round(tempos[0].bpm * 100) / 100;
  let lastBpm = firstBpm;
  for (const t of tempos.slice(1)) {
    const bpm = Math.round(t.bpm * 100) / 100;
    const pos = q(t.tick);
    if (bpm === lastBpm || pos >= lastEnd) continue;
    lastBpm = bpm;
    const mi = measureAt(pos);
    extras[mi].push(`<sound tempo="${bpm}">${offsetXml(pos, mi)}</sound>`);
  }
  // 文字太多的多半不是段落名（有的软件会把歌词、版权信息写成标记），就不往谱面上放了
  if (midi.texts.length <= Math.max(8, measures.length)) {
    for (const t of midi.texts) {
      const pos = q(t.tick);
      if (pos >= lastEnd) continue;
      const mi = measureAt(pos);
      const style = t.kind === 'marker' ? 'font-weight="bold"' : 'font-style="italic"';
      extras[mi].push(
        `<direction placement="above"><direction-type><words ${style}>${escapeXml(t.text)}</words></direction-type>` +
          `${offsetXml(pos, mi)}<staff>1</staff></direction>`,
      );
    }
  }

  // 踏板：踩下、换、抬起。抬起后不到半拍又踩下，算一次“换踏板”
  const pedalEvents: { pos: number; down: boolean }[] = [];
  for (const p of midi.pedals) {
    if ((pedalEvents[pedalEvents.length - 1]?.down ?? false) === p.down) continue;
    pedalEvents.push({ pos: Math.min(q(p.tick), Math.max(0, lastEnd)), down: p.down });
  }
  if (pedalEvents[pedalEvents.length - 1]?.down) pedalEvents.push({ pos: lastEnd, down: false });
  const pedalList: { pos: number; type: PedalMark['type'] }[] = [];
  for (let i = 0; i < pedalEvents.length; i++) {
    const e = pedalEvents[i];
    const next = pedalEvents[i + 1];
    if (e.down) {
      pedalList.push({ pos: e.pos, type: 'start' });
    } else if (next && next.pos - e.pos <= 2) {
      pedalList.push({ pos: e.pos, type: 'change' });
      i++;
    } else {
      pedalList.push({ pos: e.pos, type: 'stop' });
    }
  }
  // 画成左手谱下方的踏板线。真人弹奏录下来的踏板数据又密又碎，画出来没法看，那种只用于播放
  const pedalMarks: PedalMark[][] = measures.map(() => []);
  const drawPedal = pedalList.length <= measures.length * 8;
  for (const p of pedalList) {
    const mi = measureAt(p.pos);
    if (drawPedal) {
      pedalMarks[mi].push({ offset: p.pos - measures[mi].start, type: p.type });
      continue;
    }
    const sound = (down: boolean): string => `<sound damper-pedal="${down ? 'yes' : 'no'}">${offsetXml(p.pos, mi)}</sound>`;
    if (p.type !== 'start') extras[mi].push(sound(false));
    if (p.type !== 'stop') extras[mi].push(sound(true));
  }
  const pedalXml = (type: PedalMark['type'], offset: number): string =>
    `<direction placement="below"><direction-type><pedal type="${type}" line="yes"/></direction-type>` +
    `${offset ? `<offset>${offset}</offset>` : ''}<staff>2</staff></direction>`;

  const body = measures
    .map((m, mi) => {
      const parts: string[] = [`<measure number="${mi + 1}">`];
      const prev = measures[mi - 1];
      if (mi === 0) {
        parts.push(
          `<attributes><divisions>4</divisions><key><fifths>${keys[0]}</fifths></key>` +
            `<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time><staves>2</staves>` +
            '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>',
          '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>' +
            `<per-minute>${Math.round(firstBpm)}</per-minute></metronome></direction-type><staff>1</staff>` +
            `<sound tempo="${firstBpm}"/></direction>`,
        );
      } else {
        const keyChanged = keys[mi] !== keys[mi - 1];
        const timeChanged = prev.beats !== m.beats || prev.beatType !== m.beatType;
        if (keyChanged || timeChanged) {
          parts.push(
            '<attributes>' +
              (keyChanged ? `<key><fifths>${keys[mi]}</fifths></key>` : '') +
              (timeChanged ? `<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time>` : '') +
              '</attributes>',
          );
        }
      }
      parts.push(...extras[mi]);
      for (const piece of staffPieces[0][mi]) parts.push(pieceXml(piece, 1, 1, keys[mi]));
      parts.push(`<backup><duration>${m.len}</duration></backup>`);
      // 踏板记号插在它所在的那个音符前面；不在音符起点上的，用 offset 记下差多少
      const marks = pedalMarks[mi];
      let at = 0;
      let k = 0;
      for (const piece of staffPieces[1][mi]) {
        for (; k < marks.length && marks[k].offset < at + piece.dur; k++) parts.push(pedalXml(marks[k].type, marks[k].offset - at));
        parts.push(pieceXml(piece, 2, 5, keys[mi]));
        at += piece.dur;
      }
      for (; k < marks.length; k++) parts.push(pedalXml(marks[k].type, marks[k].offset - at));
      if (mi === measures.length - 1) parts.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
      parts.push('</measure>');
      return parts.join('');
    })
    .join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">' +
    `<work><work-title>${escapeXml(title)}</work-title></work>` +
    `<identification>${composer ? `<creator type="composer">${escapeXml(composer)}</creator>` : ''}` +
    '<encoding><software>schwingt MIDI import</software></encoding></identification>' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1">\n${body}\n</part></score-partwise>\n`;

  return { xml, warnings, durations, levels };
}
