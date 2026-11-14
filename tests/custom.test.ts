import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addLyrics, lyricLength, lyricSlots } from '../src/model/lyrics';
import { parseMusicXml, parseXml } from '../src/model/musicxml';
import { Timeline } from '../src/model/timeline';
import type { NoteEvent } from '../src/model/types';

// scripts/make-custom-fanfangxiang.mjs 生成的谱子：改了编配之后，这里守住几条不该变的性质
const xml = readFileSync(resolve(__dirname, '../public/scores/fanfangxiang-de-zhong-custom.musicxml'), 'utf8');

describe('反方向的钟 专属编配', () => {
  const score = parseMusicXml(xml);
  const right = score.notes.filter((n) => n.track === 0);
  const left = score.notes.filter((n) => n.track === 1);
  /** 第 from–to 小节（从 1 数起）的音，写成“小节内位置:音高:时值”，音高可以整体移几个半音 */
  const shape = (notes: NoteEvent[], from: number, to: number, shift = 0): string[] =>
    notes
      .filter((n) => n.measure >= from - 1 && n.measure <= to - 1)
      .map((n) => `${n.measure - from + 1}:${n.start}:${n.midi + shift}:${n.dur}`)
      .sort();
  const loudest = (bar: number, notes = right): number => Math.max(...notes.filter((n) => n.measure === bar - 1).map((n) => n.level ?? 1));
  /** 同时按下的音，按“小节:位置”分组 */
  const together = (notes: NoteEvent[]): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const n of notes) map.set(`${n.measure + 1}:${n.start}`, [...(map.get(`${n.measure + 1}:${n.start}`) ?? []), n.midi]);
    return map;
  };

  it('68 小节，C 大调，两只手分在中央 C 两边', () => {
    expect(score.measures).toHaveLength(68);
    for (const m of score.measures) expect([m.duration, m.fifths]).toEqual([4, 0]);
    expect(Math.min(...right.map((n) => n.midi))).toBeGreaterThanOrEqual(60);
    expect(Math.max(...left.map((n) => n.midi))).toBeLessThanOrEqual(60);
  });

  it('黑键只有升 sol 和升 fa，只出现在导歌和进副歌前那几小节', () => {
    const black = score.notes.filter((n) => n.alter !== 0);
    expect(new Set(black.map((n) => `${n.step}${n.alter}`))).toEqual(new Set(['G1', 'F1']));
    const bars = new Set(black.map((n) => n.measure + 1));
    expect([...bars].sort((a, b) => a - b)).toEqual([14, 15, 16, 17, 18, 20, 21, 42, 43, 44, 45, 46, 48, 49]);
    // 导歌的低音半音下行：升 sol、sol｜升 fa、fa
    const bass = (bar: number): number[] => left.filter((n) => n.measure === bar - 1 && (n.start === 0 || n.start === 2)).map((n) => n.midi);
    expect([...bass(14), ...bass(15)]).toEqual([44, 43, 42, 41]);
    // 第三句旋律里的升 sol
    expect(right.filter((n) => n.measure === 16).map((n) => n.midi).slice(0, 4)).toEqual([69, 71, 68, 69]);
  });

  it('重复的段落一个音都不差', () => {
    // 导歌和进副歌前的铺垫
    expect(shape(right, 42, 49)).toEqual(shape(right, 14, 21));
    expect(shape(left, 42, 49)).toEqual(shape(left, 14, 21));
    // 副歌
    expect(shape(right, 50, 57)).toEqual(shape(right, 22, 29));
    expect(shape(left, 50, 64)).toEqual(shape(left, 22, 36));
    // 高八度的副歌：右手整段高八度，左手不变（最后一句的长音两遍收得不一样长，不比）
    expect(shape(right, 30, 35)).toEqual(shape(right, 22, 27, 12));
    expect(shape(left, 30, 36)).toEqual(shape(left, 22, 28));
  });

  it('左手不跳：一个手位最宽八度，相邻手位的低音最多差两个白键；同时按下的八度只在重音小节和副歌第一拍', () => {
    const lows: number[] = [];
    for (let bar = 0; bar < 68; bar++) {
      for (const half of [0, 2]) {
        const here = left.filter((n) => n.measure === bar && n.start >= half && n.start < half + 2).map((n) => n.midi);
        if (!here.length) continue;
        // 重音小节后半是 fa、mi 两个八度，各算各的
        if (bar !== 20 && bar !== 48) expect(Math.max(...here) - Math.min(...here)).toBeLessThanOrEqual(12);
        lows.push(Math.min(...here));
      }
    }
    for (let i = 1; i < lows.length; i++) expect(Math.abs(lows[i] - lows[i - 1])).toBeLessThanOrEqual(4);
    const octaves = [...together(left)].filter(([, midis]) => midis.length > 1);
    for (const [, midis] of octaves) expect(Math.max(...midis) - Math.min(...midis)).toBe(12);
    expect([...new Set(octaves.map(([key]) => Number(key.split(':')[0])))]).toEqual([21, 22, 30, 49, 50, 58]);
  });

  it('右手同时最多三个音，都在六度以内，只有最后一个和弦是七度', () => {
    for (const [key, midis] of together(right)) {
      expect(midis.length).toBeLessThanOrEqual(3);
      expect(Math.max(...midis) - Math.min(...midis)).toBeLessThanOrEqual(key.startsWith('68:') ? 10 : 9);
    }
  });

  it('力度：前奏最轻，从主歌一路推到重音小节最响，副歌比主歌响，间奏和尾奏轻下来', () => {
    expect(loudest(2)).toBeLessThan(loudest(6));
    expect(loudest(6)).toBeLessThan(loudest(10));
    expect(loudest(13)).toBeLessThanOrEqual(loudest(14));
    for (let bar = 15; bar < 21; bar++) expect(loudest(bar)).toBeLessThan(loudest(bar + 1));
    expect(loudest(21)).toBe(Math.max(...right.map((n) => n.level ?? 1)));
    expect(loudest(22)).toBeGreaterThan(loudest(6) * 1.4);
    expect(loudest(30)).toBeGreaterThan(loudest(22));
    expect(loudest(38)).toBeLessThan(loudest(6));
    expect(loudest(68)).toBeLessThan(loudest(2));
    // 右手和弦里旋律以外的音比旋律轻
    const first = right.filter((n) => n.measure === 20 && n.start === 0).sort((a, b) => b.midi - a.midi);
    expect(first[1].level!).toBeLessThan(first[0].level!);
  });

  it('重音小节左手是八度，踏板一拍一换；最后一拍是冲进副歌的四个十六分音符', () => {
    const hit = (beat: number): number[] =>
      left
        .filter((n) => n.measure === 20 && n.start === beat)
        .map((n) => n.midi)
        .sort((a, b) => a - b);
    expect([hit(0), hit(1), hit(2), hit(3)]).toEqual([
      [40, 52],
      [40, 52],
      [41, 53],
      [40, 52],
    ]);
    expect(score.measures[20].pedals).toEqual([
      { offset: 0, type: 'change' },
      { offset: 1, type: 'change' },
      { offset: 2, type: 'change' },
      { offset: 3, type: 'change' },
      { offset: 4, type: 'stop' },
    ]);
    for (const [down, up] of new Timeline(score).pedals) expect(up - down).toBeLessThanOrEqual(4 + 1e-9);
    const run = right.filter((n) => n.measure === 20 && n.start >= 3);
    expect(run.map((n) => [n.midi, n.dur])).toEqual([
      [74, 0.25],
      [76, 0.25],
      [78, 0.25],
      [80, 0.25],
    ]);
    // 落在副歌第一拍的 la 上
    expect(Math.max(...right.filter((n) => n.measure === 21 && n.start === 0).map((n) => n.midi))).toBe(81);
  });

  it('尾奏把动机倒过来弹一遍，渐慢', () => {
    const motif = (bar: number): number[] =>
      right
        .filter((n) => n.measure === bar - 1)
        .map((n) => n.midi)
        .slice(0, 4);
    expect(motif(66)).toEqual([81, 79, 76, 74]);
    expect(motif(67)).toEqual([...motif(66)].reverse());
    expect(score.measures[66].tempos.map((t) => t.bpm)).toEqual([82, 74]);
    expect(score.measures[67].tempos.map((t) => t.bpm)).toEqual([62, 52]);
  });

  it('歌词位置：162 个字，重复的段落用同一段歌词', () => {
    const doc = parseXml(xml);
    const slots = lyricSlots(doc);
    expect(lyricLength(slots)).toBe(162);
    // 主歌 65、导歌 33、副歌两段各 32；导歌和副歌各出现两遍
    expect(slots).toHaveLength(65 + 2 * (33 + 32 + 32));
    const at = (bar: number): number[] => slots.filter((s) => s.measure === String(bar)).map((s) => s.index);
    expect(at(42)).toEqual(at(14));
    expect(at(50)).toEqual(at(22));
    expect(at(58)).toEqual(at(30));
    // 每个位置上都有一个不是连线延续过来的旋律音，字都能写上去
    const tokens = Array.from({ length: 162 }, (_, i) => `字${i}`);
    expect(addLyrics(doc, tokens)).toBe(slots.length);
  });
});
