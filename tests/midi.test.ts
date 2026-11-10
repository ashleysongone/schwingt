import { describe, expect, it } from 'vitest';
import { parseMidi } from '../src/io/midi';
import { interpret } from '../src/io/open';
import { decompose, midiToMusicXml, spell } from '../src/model/fromMidi';
import { Timeline } from '../src/model/timeline';

// ---------- 拼一个最小的 MIDI 文件 ----------

interface Ev {
  tick: number;
  bytes: number[];
}

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const note = (tick: number, dur: number, midi: number, ch = 0): Ev[] => [
  { tick, bytes: [0x90 | ch, midi, 80] },
  { tick: tick + dur, bytes: [0x80 | ch, midi, 0] },
];
const tempo = (tick: number, bpm: number): Ev => {
  const us = Math.round(60_000_000 / bpm);
  return { tick, bytes: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] };
};
const timeSig = (tick: number, beats: number, power: number): Ev => ({ tick, bytes: [0xff, 0x58, 4, beats, power, 24, 8] });
const keySig = (tick: number, fifths: number): Ev => ({ tick, bytes: [0xff, 0x59, 2, fifths & 0xff, 0] });
const trackName = (name: string): Ev => {
  const b = Array.from(new TextEncoder().encode(name));
  return { tick: 0, bytes: [0xff, 0x03, b.length, ...b] };
};
const pedal = (tick: number, down: boolean): Ev => ({ tick, bytes: [0xb0, 64, down ? 127 : 0] });

function track(events: Ev[]): number[] {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.tick - b.e.tick || Number((b.e.bytes[0] & 0xf0) === 0x80) - Number((a.e.bytes[0] & 0xf0) === 0x80) || a.i - b.i);
  const body: number[] = [];
  let last = 0;
  for (const { e } of sorted) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...body];
}

function smf(ppq: number, tracks: Ev[][], format = 1): ArrayBuffer {
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, (ppq >> 8) & 0xff, ppq & 0xff];
  return new Uint8Array([...head, ...tracks.flatMap(track)]).buffer;
}

const Q = 480;

describe('MIDI 读取', () => {
  it('音符、速度、拍号、调号、音轨名、踏板', () => {
    const file = parseMidi(
      smf(Q, [
        [tempo(0, 90), timeSig(0, 3, 2), keySig(0, -1)],
        [trackName('Right Hand'), ...note(0, 456, 60), ...note(Q, 456, 62), pedal(0, true), pedal(Q, false)],
      ]),
    );
    expect(file.ppq).toBe(480);
    expect(file.tempos[0].bpm).toBeCloseTo(90, 3);
    expect(file.timeSigs[0]).toMatchObject({ beats: 3, beatType: 4 });
    expect(file.keySigs[0]).toMatchObject({ fifths: -1, minor: false });
    expect(file.trackNames[1]).toBe('Right Hand');
    expect(file.notes.map((n) => [n.tick, n.dur, n.midi, n.track])).toEqual([
      [0, 456, 60, 1],
      [480, 456, 62, 1],
    ]);
    expect(file.pedals).toEqual([
      { tick: 0, down: true },
      { tick: 480, down: false },
    ]);
  });

  it('力度为 0 的 note-on 当作松键，省略状态字节也能读', () => {
    // 90 3C 50 | (省略状态) 3C 00 | (省略状态) 3E 50 | 3E 00
    const body = [0, 0x90, 60, 80, 0x83, 0x60, 60, 0, 0, 62, 80, 0x83, 0x60, 62, 0, 0, 0xff, 0x2f, 0];
    const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body];
    const file = parseMidi(new Uint8Array(bytes).buffer);
    expect(file.notes.map((n) => [n.tick, n.dur, n.midi])).toEqual([
      [0, 480, 60],
      [480, 480, 62],
    ]);
  });

  it('不是 MIDI 的文件报错', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow();
  });
});

describe('时值拆分', () => {
  const four = { beats: 4, beatType: 4 };
  const six8 = { beats: 6, beatType: 8 };
  const cases: [number, number, number[]][] = [
    [0, 16, [16]],
    [0, 12, [12]],
    [4, 12, [12]],
    [0, 10, [8, 2]],
    [0, 7, [6, 1]],
    [0, 5, [4, 1]],
    [4, 6, [4, 2]],
    [8, 6, [6]],
    [2, 4, [4]],
    [2, 6, [2, 4]],
    [6, 4, [2, 2]],
    [10, 4, [4]],
    [1, 3, [3]],
    [1, 2, [2]],
    [3, 2, [1, 1]],
    [6, 2, [2]],
    [0, 3, [3]],
  ];
  it.each(cases)('4/4 拍里从 %i 开始、长 %i', (p, d, expected) => {
    expect(decompose(p, d, four)).toEqual(expected);
  });

  it('6/8 拍按附点四分音符为一拍', () => {
    expect(decompose(0, 12, six8)).toEqual([12]);
    expect(decompose(6, 6, six8)).toEqual([6]);
    expect(decompose(2, 4, six8)).toEqual([4]);
    expect(decompose(4, 4, six8)).toEqual([2, 2]);
  });
});

describe('音名写法', () => {
  it('按调号选升降', () => {
    expect(spell(66, 1)).toEqual({ step: 'F', alter: 1, octave: 4 });
    expect(spell(70, -2)).toEqual({ step: 'B', alter: -1, octave: 4 });
    expect(spell(61, 0)).toEqual({ step: 'C', alter: 1, octave: 4 });
    // F 大调里的 61 更常见的身份是 d 小调的导音，写成 C♯
    expect(spell(61, -1)).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(spell(63, -1)).toEqual({ step: 'E', alter: -1, octave: 4 });
    expect(spell(66, -2)).toEqual({ step: 'F', alter: 1, octave: 4 });
    expect(spell(68, -2)).toEqual({ step: 'A', alter: -1, octave: 4 });
    expect(spell(70, 0)).toEqual({ step: 'B', alter: -1, octave: 4 });
    expect(spell(60, 7)).toEqual({ step: 'B', alter: 1, octave: 3 });
    expect(spell(59, -7)).toEqual({ step: 'C', alter: -1, octave: 4 });
    expect(spell(60, 0)).toEqual({ step: 'C', alter: 0, octave: 4 });
  });
});

describe('MIDI 转谱', () => {
  it('两条音轨分别是左右手', () => {
    const data = smf(Q, [
      [tempo(0, 90), timeSig(0, 4, 2)],
      // 第一条音轨音低，是左手
      [...note(0, 1900, 48), ...note(4 * Q, 2 * Q - 20, 48), ...note(4 * Q, 2 * Q - 20, 52), ...note(4 * Q, 2 * Q - 20, 55), ...note(6 * Q, 2 * Q - 20, 47)],
      [...[0, 1, 2, 3].flatMap((i) => note(i * Q, 456, 60 + i * 2)), ...note(4 * Q, 2 * Q - 24, 67), ...note(6 * Q, 2 * Q - 24, 72)],
    ]);
    const opened = interpret(data, '练习曲.mid');
    expect(opened.generated).toBe(true);
    expect(opened.warnings).toEqual([]);
    const { score } = opened;
    expect(score.title).toBe('练习曲');
    expect(score.tracks.map((t) => t.name)).toEqual(['右手', '左手']);
    expect(score.measures).toHaveLength(2);
    expect(score.measures[0].tempos[0]).toEqual({ offset: 0, bpm: 90 });
    const right = score.notes.filter((n) => n.track === 0);
    expect(right.map((n) => [n.measure, n.start, n.dur, n.midi])).toEqual([
      [0, 0, 1, 60],
      [0, 1, 1, 62],
      [0, 2, 1, 64],
      [0, 3, 1, 66],
      [1, 0, 2, 67],
      [1, 2, 2, 72],
    ]);
    const left = score.notes.filter((n) => n.track === 1);
    expect(left.map((n) => [n.measure, n.start, n.dur, n.midi])).toEqual([
      [0, 0, 4, 48],
      [1, 0, 2, 48],
      [1, 0, 2, 52],
      [1, 0, 2, 55],
      [1, 2, 2, 47],
    ]);
    // 66 在没有调号线索时：这几个音最贴近 G 大调，写成 F♯
    expect(score.measures[0].fifths).toBe(1);
    expect(right[3]).toMatchObject({ step: 'F', alter: 1 });
  });

  it('只有一条音轨时按音高分手，并给出提示', () => {
    const events = [
      ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => note(i * (Q / 2), Q / 2 - 10, [48, 55, 52, 55][i % 4])),
      ...[0, 1, 2, 3].flatMap((i) => note(i * Q, Q - 20, [72, 74, 76, 77][i])),
    ];
    const opened = interpret(smf(Q, [events], 0), 'one.mid');
    expect(opened.warnings.join()).toContain('按音高自动分手');
    const { score } = opened;
    expect(score.notes.filter((n) => n.track === 0).map((n) => n.midi)).toEqual([72, 74, 76, 77]);
    expect(score.notes.filter((n) => n.track === 1)).toHaveLength(8);
  });

  it('同一只手里按住的长音在谱面上记短，播放时仍是原来的长度', () => {
    const data = smf(Q, [
      [...[0, 1, 2, 3].flatMap((i) => note(i * Q, Q - 20, 72))],
      // 左手：低音 C 按满一小节，上面在第二拍起八分音符
      [...note(0, 4 * Q - 20, 36), ...note(Q, Q / 2 - 10, 55), ...note(Q + Q / 2, Q / 2 - 10, 52), ...note(2 * Q, 2 * Q - 20, 55)],
    ]);
    const conv = midiToMusicXml(parseMidi(data), 't');
    // 谱面上低音 C 只记到下一个音起来（一个四分音符）
    expect(conv.xml).toContain('<pitch><step>C</step><octave>2</octave></pitch><duration>4</duration>');
    const { score } = interpret(data, 't.mid');
    const bass = score.notes.find((n) => n.midi === 36)!;
    expect(bass.dur).toBe(4);
    const tl = new Timeline(score);
    expect(tl.notes.find((n) => n.note.midi === 36)!.end).toBe(4);
  });

  it('跨小节的音用连音线，读回来还是一个音', () => {
    const data = smf(Q, [
      [...note(2 * Q, 4 * Q - 20, 60), ...note(6 * Q, 2 * Q - 20, 62)],
      [...note(0, 8 * Q - 20, 36)],
    ]);
    const conv = midiToMusicXml(parseMidi(data), 't');
    expect(conv.xml.match(/<tie type="start"\/>/g)!.length).toBeGreaterThanOrEqual(2);
    const { score } = interpret(data, 't.mid');
    expect(score.notes.map((n) => [n.track, n.measure, n.start, n.dur, n.midi])).toEqual([
      [1, 0, 0, 8, 36],
      [0, 0, 2, 4, 60],
      [0, 1, 2, 2, 62],
    ]);
  });

  it('切分节奏对齐到十六分音符', () => {
    // 八分、四分（后半拍起）、八分，后半小节再来一个盖住小节正中间的四分音符
    const data = smf(Q, [[...note(0, 230, 60), ...note(240, 470, 62), ...note(720, 230, 64), ...note(960, 950, 65)], [...note(0, 1900, 36)]]);
    const { score, doc } = interpret(data, 's.mid');
    expect(score.notes.filter((n) => n.track === 0).map((n) => [n.start, n.dur])).toEqual([
      [0, 0.5],
      [0.5, 1],
      [1.5, 0.5],
      [2, 2],
    ]);
    // 后半拍起的四分音符照常写成四分音符
    const types = Array.from(doc.getElementsByTagName('note'))
      .filter((n) => n.getElementsByTagName('staff')[0].textContent === '1')
      .map((n) => n.getElementsByTagName('type')[0]?.textContent);
    expect(types).toEqual(['eighth', 'quarter', 'eighth', 'half']);
  });

  it('盖住小节正中间的音拆开用连音线连', () => {
    const data = smf(Q, [[...note(0, 3 * 240 - 10, 60), ...note(3 * 240, 470, 62), ...note(5 * 240, 3 * 240 - 10, 64)], [...note(0, 1900, 36)]]);
    const { score, doc } = interpret(data, 's.mid');
    expect(score.notes.filter((n) => n.track === 0).map((n) => [n.start, n.dur])).toEqual([
      [0, 1.5],
      [1.5, 1],
      [2.5, 1.5],
    ]);
    const types = Array.from(doc.getElementsByTagName('note'))
      .filter((n) => n.getElementsByTagName('staff')[0].textContent === '1')
      .map((n) => n.getElementsByTagName('type')[0]?.textContent + (n.getElementsByTagName('dot').length ? '.' : ''));
    expect(types).toEqual(['quarter.', 'eighth', 'eighth', 'eighth', 'quarter']);
  });

  it('中途转调时换调号', () => {
    // 前 16 小节 C 大调音阶，后 16 小节 D 大调音阶
    const scale = (base: number, bar: number): Ev[] => [0, 2, 4, 5, 7, 9, 11, 12].flatMap((s, i) => note(bar * 4 * Q + i * (Q / 2), Q / 2 - 10, base + s));
    const first = Array.from({ length: 16 }, (_, i) => i);
    const second = first.map((i) => i + 16);
    const right = [...first.flatMap((b) => scale(60, b)), ...second.flatMap((b) => scale(62, b))];
    const left = [...first.flatMap((b) => note(b * 4 * Q, 4 * Q - 20, 36)), ...second.flatMap((b) => note(b * 4 * Q, 4 * Q - 20, 38))];
    const { score } = interpret(smf(Q, [right, left]), 'k.mid', { title: '转调', composer: '某人' });
    expect(score.title).toBe('转调');
    expect(score.composer).toBe('某人');
    expect(score.measures.map((m) => m.fifths)).toEqual([...first.map(() => 0), ...second.map(() => 2)]);
    expect(score.notes.find((n) => n.measure === 16 && n.midi === 66)).toMatchObject({ step: 'F', alter: 1 });
  });

  it('偶尔出现的变化音不会引起换调号', () => {
    const bar = (b: number, pitches: number[]): Ev[] => pitches.flatMap((p, i) => note(b * 4 * Q + i * Q, Q - 20, p));
    const right = [...bar(0, [60, 62, 64, 65]), ...bar(1, [67, 66, 67, 69]), ...bar(2, [71, 72, 68, 69]), ...bar(3, [67, 65, 64, 60])];
    const { score } = interpret(smf(Q, [right, [0, 1, 2, 3].flatMap((b) => note(b * 4 * Q, 4 * Q - 20, 36))]), 'c.mid');
    expect(score.measures.map((m) => m.fifths)).toEqual([0, 0, 0, 0]);
  });

  it('没按满的音在谱面上补齐，不留零碎的休止符', () => {
    // 全音符只按到 95%，断奏的八分音符只按了一半
    const data = smf(Q, [
      [...note(0, 1824, 72), ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => note(4 * Q + i * (Q / 2), Q / 4, 74))],
      [...note(0, 8 * Q - 20, 36)],
    ]);
    const { doc, score } = interpret(data, 'g.mid');
    const right = Array.from(doc.getElementsByTagName('note')).filter((n) => n.getElementsByTagName('staff')[0].textContent === '1');
    expect(right.filter((n) => n.getElementsByTagName('rest').length)).toHaveLength(0);
    expect(right.map((n) => n.getElementsByTagName('type')[0].textContent)).toEqual(['whole', ...Array<string>(8).fill('eighth')]);
    // 播放时仍是实际按住的长度
    expect(score.notes.find((n) => n.midi === 72)!.dur).toBe(3.75);
    expect(score.notes.find((n) => n.midi === 74)!.dur).toBe(0.25);
  });

  it('踏板和中途变速写进谱子，位置正确', () => {
    const data = smf(Q, [
      [tempo(0, 60), tempo(6 * Q, 120)],
      [...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => note(i * Q, Q - 20, 60 + (i % 5))), pedal(0, true), pedal(2 * Q, false), pedal(2 * Q + 10, true), pedal(8 * Q, false)],
      [...note(0, 8 * Q - 20, 36)],
    ]);
    const { score } = interpret(data, 'p.mid');
    expect(score.measures[0].pedals).toEqual([
      { offset: 0, type: 'start' },
      { offset: 2, type: 'stop' },
      { offset: 2, type: 'start' },
    ]);
    expect(score.measures[1].tempos).toEqual([{ offset: 2, bpm: 120 }]);
    const tl = new Timeline(score);
    expect(tl.pedals).toEqual([
      [0, 2],
      [2, 8],
    ]);
    expect(tl.secAt(8)).toBeCloseTo(6 + 1, 6);
  });

  it('拍号变化', () => {
    const data = smf(Q, [
      [timeSig(0, 3, 2), timeSig(3 * Q, 4, 2)],
      [...[0, 1, 2, 3, 4, 5, 6].flatMap((i) => note(i * Q, Q - 20, 72))],
      [...note(0, Q, 40)],
    ]);
    const { score } = interpret(data, 'm.mid');
    expect(score.measures.map((m) => [m.beats, m.beatType, m.duration])).toEqual([
      [3, 4, 3],
      [4, 4, 4],
    ]);
  });

  it('文件里写了调号就用文件里的', () => {
    const data = smf(Q, [[keySig(0, -3)], [...note(0, Q, 63), ...note(Q, Q, 65)], [...note(0, Q, 39)]]);
    const { score } = interpret(data, 'k.mid');
    expect(score.measures[0].fifths).toBe(-3);
    expect(score.notes.find((n) => n.midi === 63)).toMatchObject({ step: 'E', alter: -1 });
  });

  it('三连音会给出提示', () => {
    const third = Q / 3;
    const events = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].flatMap((i) => note(i * third, third - 10, 60 + (i % 3)));
    const conv = midiToMusicXml(parseMidi(smf(Q, [events, note(0, 4 * Q, 36)])), 't');
    expect(conv.warnings.join()).toContain('三连音');
  });

  it('没有音符时报错', () => {
    expect(() => interpret(smf(Q, [[tempo(0, 100)]]), 'e.mid')).toThrow('没有可以弹的音符');
  });
});
