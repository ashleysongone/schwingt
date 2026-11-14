// 《反方向的钟》钢琴演奏版：从一段演奏录音扒下来的谱子，生成两份 MusicXML。
// 用法：node scripts/make-cover-fanfangxiang.mjs
//
// 音符不是手写的，来自 scripts/data/fanfangxiang-cover.json：录音先用 transkun（钢琴转谱模型）转成 MIDI，
// 再对齐到十六分音符的网格上。每个音是 [小节, 位置, MIDI 音高, 时值, 力度]，小节从 0 数，位置和时值以十六分音符为单位。
// 前奏和尾奏是自由速度弹的，对齐时按乐句摆回了拍子上。
//
// 两份谱子：
// - 原版（降 B 大调，两个降号）：照录音记，只做了分手和记谱上的整理。机器转的谱，个别音会有出入
// - 简化版（移到 C 调）：
//   · 右手只留旋律，拍点上最多再垫一个音（三度到六度）；高八度的主题降回中音区
//   · 左手不弹八度和大跳，每半小节一个根音加一个双音，手位不超过六度，换和弦只挪一两个键
//   · 导歌照原曲用到升 sol、升 fa
//
// 小节的记法见 scripts/lib/score.mjs。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeScore } from './lib/score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(resolve(HERE, 'data/fanfangxiang-cover.json'), 'utf8'));
const OUT = resolve(HERE, '../public/scores/fanfangxiang-de-zhong-cover.musicxml');
const OUT_EASY = resolve(HERE, '../public/scores/fanfangxiang-de-zhong-cover-easy.musicxml');

const BAR = 16;
/**
 * 转谱漏掉的音，补回去：前奏、尾奏同一句弹了八遍，其余几遍这两个位置都有音。
 * [小节, 位置, MIDI 音高, 时值, 力度]
 */
const MISSED = [
  [4, 10, 48, 6, 75],
  [96, 12, 65, 4, 70],
];
/**
 * 简化版里改写的小节（小节从 0 数）：进副歌前这一小节，原版是“短长、短长”三个十六分音符一组的来回，
 * 重音不在拍子上，很绕。简化版改成一拍两个音的来回，音没变。
 */
const EASY_REWRITE = { 30: 'A4:2 B4:2 A4:2 B4:2 A4:2 B4:2 A4:2 B4:2', 70: 'A4:2 B4:2 A4:2 B4:2 A4:2 B4:2 A4:2 B4:2' };
/** 段落。free：自由速度的前奏、尾奏；high：高八度的主题；vamp：只有左手的过门。dyn 是写在段落开头的力度记号 */
const SECTIONS = [
  { from: 0, label: '前奏', kind: 'free', dyn: 'p' },
  { from: 8, label: '主题', kind: 'high', dyn: 'mf' },
  { from: 16, label: '主歌', dyn: 'mp' },
  { from: 24, label: '导歌', dyn: 'mf' },
  { from: 32, label: '副歌', dyn: 'f' },
  { from: 40, label: '副歌（第二遍）' },
  { from: 48, label: '间奏', dyn: 'mp' },
  { from: 52, label: '过门', kind: 'vamp' },
  { from: 56, label: '主题', kind: 'high', dyn: 'mf' },
  { from: 64, label: '导歌', dyn: 'mf' },
  { from: 72, label: '副歌', dyn: 'f' },
  { from: 80, label: '副歌（第二遍）' },
  { from: 88, label: '副歌（第三遍）' },
  { from: 96, label: '尾奏', kind: 'free', dyn: 'p' },
];
const sectionOf = (bar) => SECTIONS.findLast((s) => s.from <= bar);

// ---------- 音名 ----------
const FLAT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const namer = (names) => (midi) => names[midi % 12] + (Math.floor(midi / 12) - 1);

// ---------- 分手 ----------
/**
 * 一小节里的音按位置分给两只手。
 * 分界：前奏、尾奏在中央 C 以下归左手；过门只有伴奏，分界抬到 F4；其余在 D4 及以下归左手。
 * 左手同时按下的音如果超过八度（低音八度上面还叠着和弦），上面那几个音只能是右手帮忙弹的，
 * 分给右手并标成 fill：它们不是旋律。
 */
function splitHands(notes, kind) {
  const limit = kind === 'free' ? 59 : kind === 'vamp' ? 65 : 62;
  const lh = [];
  const rh = [];
  for (let pos = 0; pos < BAR; pos++) {
    const here = notes.filter((n) => n.pos === pos);
    const low = here.filter((n) => n.midi <= limit);
    const bottom = Math.min(...low.map((n) => n.midi));
    for (const n of here) {
      if (n.midi > limit) rh.push(n);
      else if (n.midi - bottom > 12) rh.push({ ...n, fill: true });
      else lh.push(n);
    }
  }
  return { lh, rh };
}

/** 同一位置的音合成一个和弦：{ pos, pitches（从高到低）, len } */
function toEvents(notes) {
  const map = new Map();
  for (const n of notes) {
    const ev = map.get(n.pos) ?? { pos: n.pos, pitches: [], len: 0 };
    if (!ev.pitches.includes(n.midi)) ev.pitches.push(n.midi);
    ev.len = Math.max(ev.len, n.dur);
    map.set(n.pos, ev);
  }
  return [...map.values()].sort((a, b) => a.pos - b.pos).map((ev) => ({ ...ev, pitches: ev.pitches.sort((a, b) => b - a) }));
}

// ---------- 时值 ----------
const even = (n) => n + (n % 2);
/**
 * 一个音记多长。踩着踏板弹，手抬得早不等于声音停了，所以间隔短的一律记到下一个音；
 * 间隔长的看实际按了多久，差不多按满就记满，否则按实际长度记，后面补休止。
 */
function writtenLength(ev, gap, hand) {
  if (hand === 'lh') {
    if (gap <= 8 || ev.len >= gap - 4) return gap;
    return Math.min(gap, Math.max(4, even(ev.len)));
  }
  if (gap <= 8 || ev.len >= gap - 2) return gap;
  return Math.min(gap, Math.max(2, even(ev.len)));
}

/** 从 pos 开始的一段时值拆成能写出来的音符：不在拍子中间跨拍，长音从拍点起；cut 是必须断开的位置（那里要放记号） */
function pieces(pos, dur, cut) {
  const out = [];
  while (dur > 0) {
    const inBeat = pos % 4;
    const room = inBeat ? 4 - inBeat : cut > pos ? cut - pos : dur;
    const fits = [16, 12, 8, 6, 4, 3, 2, 1].find((d) => d <= Math.min(dur, room) && (d !== 12 || pos % 8 === 0 || pos === 4));
    out.push(fits);
    pos += fits;
    dur -= fits;
  }
  return out;
}

/**
 * 一只手一小节的音符写成 lib 的记法。carry 是上一小节连过来的音（{ pitches, len }），cut 见 pieces。
 * 返回 { text, starts（每个音符开始的位置）, carry（要连到下一小节的音） }
 */
function writeHand(events, hand, name, carry, nextStartsAt, cut = 0) {
  const list = [...events];
  if (carry && (list[0]?.pos ?? BAR) > 0) list.unshift({ pos: 0, pitches: carry.pitches, len: carry.len });
  const tokens = [];
  const starts = [];
  let out = null;
  let at = 0;
  const emit = (pitches, dur, tieOut) => {
    const ps = pieces(at, dur, cut);
    ps.forEach((d, i) => {
      starts.push(at);
      const tie = pitches && (i < ps.length - 1 || tieOut) ? '~' : '';
      tokens.push(`${pitches ? pitches.map(name).join('+') : 'r'}:${d}${tie}`);
      at += d;
    });
  };
  list.forEach((ev, i) => {
    if (ev.pos > at) emit(null, ev.pos - at, false);
    const gap = (list[i + 1]?.pos ?? BAR) - ev.pos;
    const dur = writtenLength(ev, gap, hand);
    // 按到小节线以后还没松手，下一小节这只手又不是一开始就有音：连过去
    const over = ev.pos + ev.len - BAR;
    const tieOut = i === list.length - 1 && dur === gap && over >= 4 && nextStartsAt >= 4;
    if (tieOut) out = { pitches: ev.pitches, len: Math.min(over, nextStartsAt) };
    emit(ev.pitches, dur, tieOut);
  });
  if (at < BAR) emit(null, BAR - at, false);
  return { text: tokens.join(' '), starts, carry: out };
}

// ---------- 和声 ----------
/**
 * 按低音认和弦。键是录音里低音的音级（降 B 大调），值是原版的和弦名，和移到 C 调以后简化版用的东西：
 * 和弦名、左手的根音和双音（中音区，一个手位）、前奏尾奏用的低一个八度的根音和五度。
 */
const CHORDS = {
  3: { name: 'Eb', easy: 'F', root: 'F3', dyad: 'C4+A3', low: ['F2', 'C3'] },
  5: { name: 'F', easy: 'G', root: 'G3', dyad: 'D4+B3', low: ['G2', 'D3'] },
  7: { name: 'Gm', easy: 'Am', root: 'A3', dyad: 'E4+C4', low: ['A2', 'E3'] },
  6: { name: 'D/F#', easy: 'E/G#', root: 'G#3', dyad: 'E4+B3', low: ['G#2', 'E3'] },
  4: { name: 'Em7b5', easy: 'F#m7b5', root: 'F#3', dyad: 'C4+A3', low: ['F#2', 'C3'] },
  0: { name: 'Cm', easy: 'Dm', root: 'D3', dyad: 'A3+F3', low: ['D3', 'A3'] },
  2: { name: 'D7', easy: 'E7', root: 'E3', dyad: 'B3+G#3', low: ['E2', 'B2'] },
};

/** 半小节里的低音：C3 以下出现最多的那个音级，落在半小节开头的多算两票 */
function bassOf(lh, half) {
  const votes = new Map();
  for (const n of lh) {
    if (n.midi >= 48 || n.pos < half || n.pos >= half + 8) continue;
    votes.set(n.midi % 12, (votes.get(n.midi % 12) ?? 0) + (n.pos === half ? 3 : 1));
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best && CHORDS[best[0]] ? best[0] : undefined;
}

// ---------- 力度 ----------
/** 录音里的平均力度折成播放的轻重：86 算平常 */
function levelOf(notes) {
  if (!notes.length) return 1;
  const mean = notes.reduce((sum, n) => sum + n.vel, 0) / notes.length;
  return Math.round(Math.min(1.35, Math.max(0.5, mean / 86)) * 100) / 100;
}

// ---------- 简化版的右手 ----------
const UP = 2; // 降 B 大调移到 C 调

/** 右手只留旋律；拍点上如果原来是和弦，再留一个离旋律三度到六度的音。高八度的主题降一个八度 */
function easyRight(rh, kind) {
  const events = toEvents(rh.filter((n) => !n.fill));
  return events.map((ev) => {
    const top = ev.pitches[0];
    const under = ev.pos % 4 === 0 ? ev.pitches.find((p) => top - p >= 3 && top - p <= 9) : undefined;
    const shift = (p) => p + UP - (kind === 'high' && top >= 77 ? 12 : 0);
    return { pos: ev.pos, pitches: under === undefined ? [shift(top)] : [shift(top), shift(under)], len: ev.len };
  });
}

/** 简化版的左手：每半小节一个根音、一个双音。前奏尾奏换成低音区的根音加五度，弹完停住 */
function easyLeft(first, second, kind, last) {
  if (kind === 'free') {
    const [root, fifth] = first.low;
    if (last) return `${root}:2 ${fifth}:6~ ${fifth}:8^`;
    if (first === second) return `${root}:2 ${fifth}:6~ ${fifth}:8`;
    return `${root}:2 ${fifth}:6 ${second.low[0]}:2 ${second.low[1]}:6`;
  }
  return `${first.root}:4 ${first.dyad}:4 ${second.root}:4 ${second.dyad}:4`;
}

// ---------- 组装 ----------
function build() {
  const byBar = Array.from({ length: DATA.bars }, () => []);
  for (const [bar, pos, midi, dur, vel] of [...DATA.notes, ...MISSED]) byBar[bar].push({ pos, midi, dur, vel });
  const hands = byBar.map((notes, bar) => splitHands(notes, sectionOf(bar).kind));
  const firstPos = (list) => (list.length ? Math.min(...list.map((n) => n.pos)) : BAR);

  const original = [];
  const easy = [];
  const flat = namer(FLAT_NAMES);
  const sharp = namer(SHARP_NAMES);
  const carry = { lh: null, rh: null, easyRh: null };
  let chord = CHORDS[3];
  let shownName = '';
  let shownEasy = '';

  byBar.forEach((notes, bar) => {
    const section = sectionOf(bar);
    const starts = section.from === bar;
    const last = bar === DATA.bars - 1;
    const { lh, rh } = hands[bar];
    const next = hands[bar + 1];

    // 和弦：每半小节认一次，认不出来就沿用前一个
    const first = (chord = CHORDS[bassOf(lh, 0)] ?? chord);
    const second = (chord = CHORDS[bassOf(lh, 8)] ?? chord);
    const marks = (key, shown) => {
      const out = [];
      if (starts || first[key] !== shown) out.push(`${first[key]}@0`);
      if (second[key] !== first[key]) out.push(`${second[key]}@8`);
      return out.join(' ');
    };
    const chords = marks('name', shownName);
    const easyChords = marks('easy', shownEasy);
    shownName = second.name;
    shownEasy = second.easy;

    const level = levelOf(notes);
    const common = {
      ...(starts ? { label: section.label, ...(section.dyn ? { dyn: section.dyn } : {}) } : {}),
      level,
      ...(bar >= DATA.bars - 3 ? { tempo: bar === DATA.bars - 3 ? '84@0' : bar === DATA.bars - 2 ? '72@0 62@8' : '54@0' } : {}),
      ...(bar === DATA.bars - 3 ? { cue: '渐慢' } : {}),
    };
    const pedal = (starts0) => [bar === 0 ? 'start@0' : starts0.includes(0) ? 'change@0' : '', starts0.includes(8) ? 'change@8' : '', last ? 'stop@16' : ''].filter(Boolean).join(' ');

    // 原版
    const left = writeHand(toEvents(lh), 'lh', flat, carry.lh, next ? firstPos(next.lh) : 0, 8);
    const right = writeHand(toEvents(rh), 'rh', flat, carry.rh, next ? firstPos(next.rh) : 0, chords.includes('@8') ? 8 : 0);
    carry.lh = left.carry;
    carry.rh = right.carry;
    // 高八度的主题记成 8va；这一段的最后一小节已经回到中音区，在它前面结束
    const end = (SECTIONS[SECTIONS.indexOf(section) + 1]?.from ?? DATA.bars) - 2;
    const ottava = section.kind === 'high' ? (starts ? 'start@0' : bar === end ? 'stop@16' : '') : '';
    original.push({ ...common, rh: right.text, lh: left.text, chords, pedal: pedal(left.starts), ...(ottava ? { ottava } : {}) });

    // 简化版
    const easyRh = easyRight(rh, section.kind);
    const nextEasy = next ? easyRight(next.rh, sectionOf(bar + 1).kind) : [];
    const easyR = writeHand(easyRh, 'rh', sharp, carry.easyRh, next ? (nextEasy[0]?.pos ?? BAR) : 0, easyChords.includes('@8') ? 8 : 0);
    carry.easyRh = easyR.carry;
    easy.push({
      ...common,
      rh: last ? 'r:4 E4+B3:12^' : (EASY_REWRITE[bar] ?? easyR.text),
      lh: easyLeft(first, second, section.kind, last),
      chords: easyChords,
      pedal: [bar === 0 ? 'start@0' : 'change@0', last ? '' : 'change@8', last ? 'stop@16' : ''].filter(Boolean).join(' '),
    });
  });
  return { original, easy };
}

const { original, easy } = build();
writeScore(OUT, {
  title: '反方向的钟（钢琴演奏版）',
  composer: '周杰伦',
  software: 'schwingt make-cover-fanfangxiang',
  tempo: DATA.tempo,
  key: -2,
  bars: original,
});
writeScore(OUT_EASY, {
  title: '反方向的钟（钢琴演奏版·简化）',
  composer: '周杰伦',
  software: 'schwingt make-cover-fanfangxiang',
  tempo: DATA.tempo,
  bars: easy,
});
