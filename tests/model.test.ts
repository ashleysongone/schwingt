import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withLabels } from '../src/model/labels';
import { parseMusicXml, parseXml } from '../src/model/musicxml';
import { unroll } from '../src/model/sequence';
import { keyName, labelFor, majorTonic } from '../src/model/solfege';
import { Timeline } from '../src/model/timeline';

const demoXml = readFileSync(resolve(__dirname, '../public/scores/twinkle.musicxml'), 'utf8');

/** 用几段小节内容拼一份最小的谱子。第一小节自动带上拍号等属性。 */
function scoreOf(measures: string[], opts: { beats?: number; beatType?: number; fifths?: number; divisions?: number } = {}): string {
  const { beats = 4, beatType = 4, fifths = 0, divisions = 1 } = opts;
  const attrs = `<attributes><divisions>${divisions}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>`;
  const body = measures
    .map((m, i) => {
      const tag = /^<measure/.test(m) ? '' : `<measure number="${i + 1}">`;
      const end = tag ? '</measure>' : '';
      const content = i === 0 ? m.replace(/^(<measure[^>]*>)?/, (all) => `${all}${attrs}`) : m;
      return `${tag}${content}${end}`;
    })
    .join('');
  return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}

const n = (step: string, octave: number, dur: number, extra = ''): string =>
  `<note>${extra.includes('<chord/>') ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration>${extra.replace('<chord/>', '')}</note>`;
const whole = n('C', 4, 4);
const fwd = '<barline location="left"><repeat direction="forward"/></barline>';
const back = '<barline location="right"><repeat direction="backward"/></barline>';

function orderOf(measures: string[]): number[] {
  return unroll(parseMusicXml(scoreOf(measures)).measures);
}

describe('示例曲解析', () => {
  const score = parseMusicXml(demoXml);

  it('基本信息', () => {
    expect(score.title).toBe('小星星');
    expect(score.composer).toBe('传统儿歌');
    expect(score.tracks.map((t) => t.name)).toEqual(['右手', '左手']);
    expect(score.measures).toHaveLength(12);
    expect(score.measures.every((m) => m.duration === 4 && m.beats === 4 && m.beatType === 4)).toBe(true);
  });

  it('音符数量和左右手归属', () => {
    expect(score.notes.filter((x) => x.track === 0)).toHaveLength(42);
    expect(score.notes.filter((x) => x.track === 1)).toHaveLength(95);
    const first = score.notes.filter((x) => x.measure === 0 && x.track === 0);
    expect(first.map((x) => x.midi)).toEqual([60, 60, 67, 67]);
    expect(first.map((x) => x.start)).toEqual([0, 1, 2, 3]);
    expect(first.map((x) => x.fingering)).toEqual(['1', '1', '4', '4']);
    const leftFirst = score.notes.filter((x) => x.measure === 0 && x.track === 1);
    expect(leftFirst.map((x) => x.midi)).toEqual([48, 55, 52, 55, 48, 55, 52, 55]);
    expect(leftFirst.map((x) => x.start)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it('结尾的柱式和弦同时发声', () => {
    const chord = score.notes.filter((x) => x.measure === 11 && x.track === 1 && x.start === 2);
    expect(chord.map((x) => x.midi).sort()).toEqual([48, 52, 55]);
    expect(chord.every((x) => x.dur === 2)).toBe(true);
  });

  it('速度和踏板', () => {
    expect(score.measures[0].tempos).toEqual([{ offset: 0, bpm: 100 }]);
    expect(score.measures[0].pedals).toEqual([
      { offset: 0, type: 'start' },
      { offset: 2, type: 'change' },
    ]);
    expect(score.measures[11].pedals.at(-1)).toEqual({ offset: 4, type: 'stop' });
  });

  it('时间线', () => {
    const tl = new Timeline(score);
    expect(tl.total).toBe(48);
    expect(tl.secAt(48)).toBeCloseTo(28.8, 6);
    expect(tl.beatAt(14.4)).toBeCloseTo(24, 6);
    expect(tl.steps).toHaveLength(93);
    expect(tl.clicks).toHaveLength(48);
    expect(tl.clicks.filter((c) => c.accent)).toHaveLength(12);
    expect(tl.pedals).toHaveLength(24);
    expect(tl.pedals[0]).toEqual([0, 2]);
    // 左手第一个音在踏板里，延续到换踏板
    const c3 = tl.notes.find((x) => x.note.track === 1)!;
    expect([c3.start, c3.end, c3.soundEnd]).toEqual([0, 0.5, 2]);
    // 恰好在换踏板时松开的音不会被下一脚踏板留住
    const g4 = tl.notes.find((x) => x.note.track === 0 && x.start === 1)!;
    expect(g4.end).toBe(2);
    expect(g4.soundEnd).toBe(2);
    expect(tl.locate(9.5)).toMatchObject({ measure: 2, offset: 1.5 });
    expect(tl.activeAt(0).map((x) => x.note.midi).sort()).toEqual([48, 60]);
    expect(tl.nextStep(0)).toBe(0.5);
    expect(tl.prevStep(0.5)).toBe(0);
    expect(tl.countIn(0)).toEqual({ count: 4, beatLen: 1, perBar: 4 });
  });

  it('只取一段小节', () => {
    const tl = new Timeline(score, { from: 4, to: 5 });
    expect(tl.segments.map((s) => s.measure)).toEqual([4, 5]);
    expect(tl.total).toBe(8);
    expect(tl.beatOfMeasure(5)).toBe(4);
    expect(tl.beatOfMeasure(0)).toBeUndefined();
    expect(tl.bpmAt(0)).toBe(100);
    expect(tl.notes[0].note.measure).toBe(4);
  });

  it('唱名标注', () => {
    const doc = withLabels(parseXml(demoXml), { mode: 'fixed', tracks: new Set([0, 1]) });
    expect(doc.getElementsByTagName('lyric')).toHaveLength(137);
    const firstNote = doc.getElementsByTagName('note')[0];
    expect(firstNote.getElementsByTagName('text')[0].textContent).toBe('do');
    const onlyRight = withLabels(parseXml(demoXml), { mode: 'number', tracks: new Set([0]) });
    expect(onlyRight.getElementsByTagName('lyric')).toHaveLength(42);
    const texts = Array.from(onlyRight.getElementsByTagName('text')).slice(0, 7).map((t) => t.textContent);
    expect(texts).toEqual(['1', '1', '5', '5', '6', '6', '5']);
    // 和弦的几个音从高到低标在第一个音上
    const notes = Array.from(doc.getElementsByTagName('note'));
    const chordHead = notes[notes.length - 3];
    expect(Array.from(chordHead.getElementsByTagName('text')).map((t) => t.textContent)).toEqual(['sol', 'mi', 'do']);
    // 原文档没有被改动
    expect(parseXml(demoXml).getElementsByTagName('lyric')).toHaveLength(0);
  });
});

describe('反复展开', () => {
  it('没有反复', () => {
    expect(orderOf([whole, whole, whole])).toEqual([0, 1, 2]);
  });

  it('从头反复', () => {
    expect(orderOf([whole, whole + back, whole])).toEqual([0, 1, 0, 1, 2]);
  });

  it('两段各自反复', () => {
    expect(orderOf([fwd + whole + back, fwd + whole + back, whole])).toEqual([0, 0, 1, 1, 2]);
  });

  it('第二段没写起始反复记号时，从上一段结束处开始', () => {
    expect(orderOf([whole + back, whole, whole + back])).toEqual([0, 0, 1, 2, 1, 2]);
  });

  it('跳房子', () => {
    const e1 = '<barline location="left"><ending number="1" type="start"/></barline>';
    const e1end = '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>';
    const e2 = '<barline location="left"><ending number="2" type="start"/></barline>';
    const e2end = '<barline location="right"><ending number="2" type="discontinue"/></barline>';
    const order = orderOf([whole, fwd + whole, whole, e1 + whole + e1end, e2 + whole + e2end, whole, whole + back]);
    expect(order).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6, 5, 6]);
  });

  it('反复三遍', () => {
    const back3 = '<barline location="right"><repeat direction="backward" times="3"/></barline>';
    expect(orderOf([whole + back3, whole])).toEqual([0, 0, 0, 1]);
  });

  it('D.C. al Fine', () => {
    const order = orderOf([whole, whole + '<direction><sound fine="yes"/></direction>', whole + '<direction><sound dacapo="yes"/></direction>']);
    expect(order).toEqual([0, 1, 2, 0, 1]);
  });

  it('D.S. al Coda', () => {
    const order = orderOf([
      whole,
      '<direction><sound segno="s"/></direction>' + whole,
      whole + '<direction><sound tocoda="c"/></direction>',
      whole + '<direction><sound dalsegno="s"/></direction>',
      '<direction><sound coda="c"/></direction>' + whole,
      whole,
    ]);
    expect(order).toEqual([0, 1, 2, 3, 1, 2, 4, 5]);
  });

  it('D.C. 之后不再反复，只走最后一个跳房子', () => {
    const e1 = '<barline location="left"><ending number="1" type="start"/></barline>';
    const e1end = '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>';
    const e2 = '<barline location="left"><ending number="2" type="start"/></barline>';
    const e2end = '<barline location="right"><ending number="2" type="discontinue"/></barline>';
    const order = orderOf([whole, e1 + whole + e1end, e2 + whole + e2end + '<direction><sound dacapo="yes"/></direction>']);
    expect(order).toEqual([0, 1, 0, 2, 0, 2]);
  });
});

describe('音符细节', () => {
  it('连音线合并成一个音，跨小节也算', () => {
    const tieStart = '<tie type="start"/>';
    const tieStop = '<tie type="stop"/>';
    const score = parseMusicXml(scoreOf([n('C', 4, 2) + n('E', 4, 2, tieStart), n('E', 4, 2, tieStop) + n('G', 4, 2)]));
    expect(score.notes.map((x) => [x.midi, x.measure, x.start, x.dur])).toEqual([
      [60, 0, 0, 2],
      [64, 0, 2, 4],
      [67, 1, 2, 2],
    ]);
    const tl = new Timeline(score);
    expect(tl.notes.map((x) => [x.start, x.end])).toEqual([
      [0, 2],
      [2, 6],
      [6, 8],
    ]);
  });

  it('连续三个音连在一起', () => {
    const both = '<tie type="stop"/><tie type="start"/>';
    const score = parseMusicXml(scoreOf([n('C', 4, 4, '<tie type="start"/>'), n('C', 4, 4, both), n('C', 4, 2, '<tie type="stop"/>') + n('D', 4, 2)]));
    expect(score.notes.map((x) => [x.midi, x.dur])).toEqual([
      [60, 10],
      [62, 2],
    ]);
  });

  it('两个声部用 backup 回到小节开头', () => {
    const xml = scoreOf([
      n('C', 5, 2, '<voice>1</voice><staff>1</staff>') +
        n('D', 5, 2, '<voice>1</voice><staff>1</staff>') +
        '<backup><duration>4</duration></backup>' +
        n('C', 3, 4, '<voice>5</voice><staff>2</staff>') +
        n('G', 3, 4, '<chord/><voice>5</voice><staff>2</staff>'),
    ]);
    const score = parseMusicXml(xml);
    expect(score.tracks).toHaveLength(2);
    expect(score.notes.map((x) => [x.track, x.midi, x.start, x.dur])).toEqual([
      [0, 72, 0, 2],
      [1, 48, 0, 4],
      [1, 55, 0, 4],
      [0, 74, 2, 2],
    ]);
  });

  it('升降号和调号', () => {
    const sharp = '<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration></note>';
    const score = parseMusicXml(scoreOf([sharp], { fifths: 2 }));
    expect(score.notes[0]).toMatchObject({ midi: 66, step: 'F', alter: 1 });
    expect(score.measures[0].fifths).toBe(2);
  });

  it('弱起小节', () => {
    const score = parseMusicXml(scoreOf(['<measure number="0" implicit="yes">' + n('G', 4, 1) + '</measure>', whole]));
    expect(score.measures[0]).toMatchObject({ implicit: true, duration: 1, nominal: 4 });
    const tl = new Timeline(score);
    expect(tl.total).toBe(5);
    expect(tl.countIn(0)).toEqual({ count: 7, beatLen: 1, perBar: 4 });
    expect(tl.clicks.map((c) => [c.beat, c.accent])).toEqual([
      [0, false],
      [1, true],
      [2, false],
      [3, false],
      [4, false],
    ]);
  });

  it('6/8 拍按附点四分音符敲节拍器', () => {
    const score = parseMusicXml(scoreOf([n('C', 4, 6)], { beats: 6, beatType: 8, divisions: 2 }));
    expect(score.measures[0].duration).toBe(3);
    const tl = new Timeline(score);
    expect(tl.clicks.map((c) => c.beat)).toEqual([0, 1.5]);
    expect(tl.countIn(0)).toEqual({ count: 2, beatLen: 1.5, perBar: 2 });
  });

  it('中途变速', () => {
    const score = parseMusicXml(
      scoreOf(['<direction><sound tempo="60"/></direction>' + whole, '<direction><sound tempo="120"/></direction>' + whole]),
    );
    const tl = new Timeline(score);
    expect(tl.secAt(4)).toBeCloseTo(4, 6);
    expect(tl.secAt(8)).toBeCloseTo(6, 6);
    expect(tl.beatAt(5)).toBeCloseTo(6, 6);
    expect(tl.bpmAt(3.9)).toBe(60);
    expect(tl.bpmAt(4)).toBe(120);
  });

  it('反复跳回时速度也回到那一段原来的速度', () => {
    const score = parseMusicXml(
      scoreOf(['<direction><sound tempo="60"/></direction>' + whole, '<direction><sound tempo="120"/></direction>' + whole + back, whole]),
    );
    const tl = new Timeline(score);
    expect(tl.segments.map((s) => s.measure)).toEqual([0, 1, 0, 1, 2]);
    expect([0, 4, 8, 12, 16].map((b) => tl.bpmAt(b))).toEqual([60, 120, 60, 120, 120]);
  });

  it('只有速度记号、没有 sound 时按记号换算', () => {
    const met = '<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>50</per-minute></metronome></direction-type></direction>';
    expect(parseMusicXml(scoreOf([met + whole])).measures[0].tempos).toEqual([{ offset: 0, bpm: 100 }]);
  });

  it('装饰音排在主音前面一点', () => {
    const grace = '<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>';
    const score = parseMusicXml(scoreOf([whole, grace + whole]));
    const tl = new Timeline(score);
    const g = tl.notes.find((x) => x.note.grace)!;
    expect(g.start).toBeCloseTo(3.875, 6);
    expect(tl.steps).toEqual([0, 4]);
  });
});

describe('唱名', () => {
  it('固定调', () => {
    expect(labelFor('C', 0, 2, 'fixed')).toBe('do');
    expect(labelFor('F', 1, 2, 'fixed')).toBe('♯fa');
    expect(labelFor('B', -1, 0, 'fixed')).toBe('♭si');
  });

  it('首调：主音唱 do', () => {
    expect(labelFor('D', 0, 2, 'movable')).toBe('do');
    expect(labelFor('F', 1, 2, 'movable')).toBe('mi');
    expect(labelFor('F', 0, 2, 'movable')).toBe('♭mi');
    expect(labelFor('E', -1, -3, 'movable')).toBe('do');
    expect(labelFor('B', 0, -3, 'movable')).toBe('♯sol');
    expect(labelFor('C', 1, 7, 'movable')).toBe('do');
  });

  it('简谱数字和音名', () => {
    expect(labelFor('B', 0, 1, 'number')).toBe('3');
    expect(labelFor('C', 1, 0, 'number')).toBe('♯1');
    expect(labelFor('C', 1, 0, 'letter')).toBe('C♯');
  });

  it('调号', () => {
    expect(majorTonic(0)).toEqual({ step: 'C', alter: 0 });
    expect(majorTonic(5)).toEqual({ step: 'B', alter: 0 });
    expect(majorTonic(6)).toEqual({ step: 'F', alter: 1 });
    expect(majorTonic(-2)).toEqual({ step: 'B', alter: -1 });
    expect(keyName(0)).toBe('C 大调（没有升降号）');
    expect(keyName(1, 'major')).toBe('G 大调（1 个升号）');
    expect(keyName(3, 'minor')).toBe('F♯ 小调（3 个升号）');
    expect(keyName(-3, 'minor')).toBe('C 小调（3 个降号）');
  });
});
