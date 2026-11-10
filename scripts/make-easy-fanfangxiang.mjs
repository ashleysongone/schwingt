// 从《反方向的钟》的完整扒谱生成 C 调简化版。
// 用法：node scripts/make-easy-fanfangxiang.mjs [--keep-rhythm] [--print]
//
// 做法：
// - 旋律取原谱的最高声部，移到 C 大调，只留单音
// - 节奏默认对齐到八分音符（十六分音符的切分和经过音拉直或去掉）；加 --keep-rhythm 保留原节奏
// - 左手每个和弦弹三个音：根音、五度（转位和弦时换成和弦里的音）、高八度，然后按住
// - 只取前奏、主歌、导歌、副歌各一遍，加一个结尾；说唱段和高八度的重复不收
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keySignature, noteName, noteOff, noteOn, pedal, readMidi, tempo, timeSignature, trackName, writeMidi } from './lib/smf.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'public/scores/fanfangxiang-de-zhong.mid');
const OUT = resolve(root, 'public/scores/fanfangxiang-de-zhong-easy.mid');
const keepRhythm = process.argv.includes('--keep-rhythm');
const print = process.argv.includes('--print');

/** 原谱是降 B 大调，升两个半音到 C 大调 */
const TRANSPOSE = 2;
/** 低于这个音的不算旋律（原调的 B♭3） */
const MELODY_FLOOR = 58;
/** 移调后旋律最高不超过 A5，超过的整段降八度 */
const MELODY_CEILING = 81;
const BAR = 16;

/**
 * 选用的段落。from/to 是原谱的小节号（从 1 数起，含两端）。
 * chordsFrom：这一段的左手改用原谱另外几小节的和声（结尾在原谱里没有伴奏）。
 */
const SECTIONS = [
  { name: '前奏', from: 1, to: 8 },
  { name: '过门', from: 17, to: 17 },
  { name: '主歌', from: 18, to: 25 },
  { name: '导歌', from: 26, to: 33 },
  { name: '副歌', from: 34, to: 41 },
  { name: '结尾', from: 106, to: 107, chordsFrom: 1 },
];

/**
 * 个别小节的旋律手工改写：[小节内位置（十六分音符）, 原调音高, 时值]。
 * 用在原谱是即兴加花、照搬反而难弹的地方。
 */
const MELODY_OVERRIDE = {
  // 副歌第六小节：原谱末尾是伴奏的加花，改成和第二小节一样落在长音上
  39: [
    [2, 72, 2],
    [4, 72, 2],
    [6, 74, 4],
    [10, 77, 6],
  ],
  // 副歌最后一小节：原谱后半小节是一串往上的琶音加花，改成落在长音上
  41: [
    [4, 70, 2],
    [6, 69, 2],
    [8, 65, 8],
  ],
};

/**
 * 个别小节的左手和声手工指定：[小节内位置, 原调低音, 低音上方第二个音的音程（半音数）, 这个和弦占多长]。
 * 导歌的低音是半音下行（原调 F♯–F–E–E♭），中间有转位和弦，自动判断容易取错音，所以照原谱的和声写死：
 * D/F♯ – B♭/F – Em7♭5 – E♭ ……移到 C 调是 E/G♯ – C/G – F♯m7♭5 – F。
 */
const LEFT_OVERRIDE = {
  26: [[0, 42, 8, 8], [8, 41, 5, 8]],
  27: [[0, 40, 3, 8], [8, 39, 7, 8]],
  28: [[0, 42, 8, 8], [8, 41, 5, 8]],
  29: [[0, 40, 8, 8], [8, 39, 7, 8]],
  30: [[0, 40, 8, 8], [8, 39, 7, 8]],
  31: [[0, 36, 7, 16]],
  32: [[0, 38, 7, 16]],
  33: [[0, 42, 8, 8], [8, 39, 7, 4], [12, 38, 7, 4]],
};

const { ppq, notes: raw, tempos } = readMidi(SRC);
const grid = ppq / 4;
const q = (tick) => Math.round(tick / grid);
const all = raw
  .map((n) => ({ on: q(n.tick), end: Math.max(q(n.tick) + 1, q(n.tick + n.dur)), midi: n.midi }))
  .sort((a, b) => a.on - b.on || b.midi - a.midi);

// ---------- 旋律：起音时没有更高的音还在响，就是最高声部 ----------
const melody = [];
for (let i = 0; i < all.length; ) {
  let j = i;
  while (j < all.length && all[j].on === all[i].on) j++;
  const top = all[i];
  const last = melody[melody.length - 1];
  const covered = last && last.end > top.on && last.midi > top.midi;
  if (!covered && top.midi >= MELODY_FLOOR) melody.push({ ...top });
  i = j;
}
melody.forEach((m, k) => {
  if (k + 1 < melody.length) m.end = Math.min(m.end, melody[k + 1].on);
});

// 手工改写的小节
for (const [bar, list] of Object.entries(MELODY_OVERRIDE)) {
  const start = (Number(bar) - 1) * BAR;
  for (let k = melody.length - 1; k >= 0; k--) if (melody[k].on >= start && melody[k].on < start + BAR) melody.splice(k, 1);
  for (const [pos, midi, dur] of list) melody.push({ on: start + pos, end: start + pos + dur, midi });
}
melody.sort((a, b) => a.on - b.on);

// ---------- 节奏拉直到八分音符 ----------
function straighten(list) {
  const taken = new Set(list.filter((m) => m.on % 2 === 0).map((m) => m.on));
  const out = [];
  for (const m of list) {
    if (m.on % 2 === 0) {
      out.push({ ...m });
      continue;
    }
    // 落在十六分位置上的音：后一个八分位置空着就往后挪（把提前的切分拉回拍点），
    // 否则前一个位置空着就往前挪，两边都有音就去掉（多半是经过音）
    const later = m.on + 1;
    const earlier = m.on - 1;
    if (!taken.has(later)) {
      taken.add(later);
      out.push({ ...m, on: later, end: Math.max(m.end, later + 2) });
    } else if (!taken.has(earlier)) {
      taken.add(earlier);
      out.push({ ...m, on: earlier });
    }
  }
  out.sort((a, b) => a.on - b.on);
  out.forEach((m, k) => {
    const next = out[k + 1]?.on ?? Infinity;
    // 时值也取整到八分音符；离下一个音只差一个八分音符以内就连过去
    let end = Math.max(m.on + 2, Math.ceil(m.end / 2) * 2);
    if (next - end <= 2) end = next;
    m.end = Math.min(end, next);
  });
  return out;
}
const tune = keepRhythm ? melody : straighten(melody);

// ---------- 和声：每半小节看一次，拍点上有低音才算换和弦 ----------
const melodyKeys = new Set(melody.map((m) => `${m.on}:${m.midi}`));
function chordAt(start) {
  const atStart = all.filter((n) => n.on === start);
  const bass = atStart[atStart.length - 1];
  if (!bass || bass.midi > 52) return undefined;
  const weight = new Array(12).fill(0);
  for (const n of all) {
    if (n.on < start || n.on >= start + 8 || melodyKeys.has(`${n.on}:${n.midi}`)) continue;
    weight[n.midi % 12] += Math.min(n.end - n.on, 8);
  }
  const bassPc = bass.midi % 12;
  // 低音上方第二个音：伴奏里有纯五度就用纯五度；没有（转位和弦）就取伴奏里分量最重的那个协和音程
  let interval = 7;
  if (!weight[(bassPc + 7) % 12]) {
    let best = 0;
    for (const iv of [8, 9, 5, 4, 3]) {
      if (weight[(bassPc + iv) % 12] > best) {
        best = weight[(bassPc + iv) % 12];
        interval = iv;
      }
    }
  }
  return { bassPc, interval, span: 8 };
}

/** 一个和弦在左手弹成：低音、第二个音、高八度的低音（和弦只占一拍时只弹前两个） */
function leftPattern(chord) {
  let bass = chord.bassPc + TRANSPOSE;
  // 低音放在 E2–E♭3 之间
  while (bass < 40) bass += 12;
  while (bass > 51) bass -= 12;
  return chord.span >= 8 ? [bass, bass + chord.interval, bass + 12] : [bass, bass + chord.interval];
}

// ---------- 按段落拼成新的曲子 ----------
const right = [];
const left = [];
const pedals = [];
const log = [];
let outBar = 0;
let lastChord;
for (const sec of SECTIONS) {
  const bars = sec.to - sec.from + 1;
  const secStart = (sec.from - 1) * BAR;
  const secEnd = sec.to * BAR;
  const part = tune.filter((m) => m.on >= secStart && m.on < secEnd);
  // 整段的高度：超过上限就整段降八度，保持旋律线条不变。
  // 看的是这一段里偏高的音（九成分位），个别冲得很高的音是伴奏的加花，不算旋律，直接去掉
  const sortedPitches = part.map((m) => m.midi).sort((a, b) => a - b);
  const high = sortedPitches[Math.floor((sortedPitches.length - 1) * 0.9)];
  let shift = TRANSPOSE;
  while (high + shift > MELODY_CEILING) shift -= 12;
  for (let k = part.length - 1; k >= 0; k--) if (part[k].midi > high + 9) part.splice(k, 1);

  for (let b = 0; b < bars; b++) {
    const srcBar = sec.from + b;
    const srcStart = (srcBar - 1) * BAR;
    const dstStart = (outBar + b) * BAR;
    const inBar = part.filter((m) => m.on >= srcStart && m.on < srcStart + BAR);
    for (const m of inBar) {
      const on = dstStart + (m.on - srcStart);
      // 段落末尾的音不拖到下一段里去
      const end = Math.min(dstStart + (m.end - srcStart), (outBar + bars) * BAR);
      right.push({ on, end, midi: m.midi + shift });
    }
    const chordBar = sec.chordsFrom ? sec.chordsFrom + b : srcBar;
    const chords = LEFT_OVERRIDE[chordBar]
      ? LEFT_OVERRIDE[chordBar].map(([pos, bass, interval, span]) => ({ pos, bassPc: bass % 12, interval, span }))
      : [0, 8].map((half) => ({ pos: half, ...chordAt((chordBar - 1) * BAR + half) })).filter((c) => c.bassPc !== undefined);
    const names = [];
    for (const chord of chords) {
      lastChord = chord;
      const pattern = leftPattern(chord);
      const at = dstStart + chord.pos;
      // 最后一个音按住，到下一次换和弦为止：先假定到小节末，后面再按实际截短
      pattern.forEach((midi, k) => {
        const last = k === pattern.length - 1;
        left.push({ on: at + k * 2, end: last ? dstStart + BAR : at + k * 2 + 2, midi, hold: last });
      });
      pedals.push(at);
      names.push(pattern.map(noteName).join('-'));
    }
    log.push(
      `${String(outBar + b + 1).padStart(2)} (${sec.name} 原${String(srcBar).padStart(3)}) 左手 ${names.join(' | ').padEnd(27)} 右手 ${inBar
        .map((m) => `${m.on - srcStart}:${noteName(m.midi + shift)}/${m.end - m.on}`)
        .join(' ')}`,
    );
  }
  outBar += bars;
}

// 收尾小节：停在最后一个和弦上（循环进行落在六级小和弦）
{
  const dstStart = outBar * BAR;
  const lastRight = right[right.length - 1];
  const [p1, p2, p3] = leftPattern({ ...lastChord, span: 16 });
  left.push({ on: dstStart, end: dstStart + 2, midi: p1 }, { on: dstStart + 2, end: dstStart + 4, midi: p2 }, { on: dstStart + 4, end: dstStart + BAR, midi: p3, hold: true });
  pedals.push(dstStart);
  right.push({ on: dstStart, end: dstStart + BAR, midi: lastRight.midi });
  log.push(`${String(outBar + 1).padStart(2)} (收尾)        左手 ${[p1, p2, p3].map(noteName).join('-')}  右手 0:${noteName(lastRight.midi)}/16`);
  outBar++;
}

// 左手按住的那个音，在下一个和弦进来时松开
left.sort((a, b) => a.on - b.on);
const chordStarts = [...pedals].sort((a, b) => a - b);
for (const n of left) {
  if (!n.hold) continue;
  const next = chordStarts.find((s) => s > n.on);
  if (next !== undefined) n.end = Math.min(n.end, next);
}

// ---------- 写成 MIDI ----------
const PPQ = 480;
const T = PPQ / 4;
const total = outBar * BAR;
const toEvents = (list, velocity) => list.flatMap((n) => [noteOn(n.on * T, n.midi, velocity), noteOff(n.end * T, n.midi)]);
const pedalEvents = [];
chordStarts.forEach((s, i) => {
  if (i > 0) pedalEvents.push(pedal(s * T, false));
  // 手先落键，脚随后踩下
  pedalEvents.push(pedal(s * T + T, true));
});
pedalEvents.push(pedal(total * T, false));

writeMidi(OUT, PPQ, [
  [tempo(0, Math.round(tempos[0]?.bpm ?? 88)), timeSignature(0, 4, 2), keySignature(0, 0)],
  [trackName('Right Hand'), ...toEvents(right, 84)],
  [trackName('Left Hand'), ...toEvents(left, 70), ...pedalEvents],
]);

if (print) console.log(log.join('\n'));
const lo = Math.min(...right.map((n) => n.midi));
const hi = Math.max(...right.map((n) => n.midi));
console.log(
  `已生成 ${OUT}\n${outBar} 小节，右手 ${right.length} 个音（${noteName(lo)}–${noteName(hi)}），左手 ${left.length} 个音，节奏${keepRhythm ? '保留原样' : '已拉直到八分音符'}`,
);
