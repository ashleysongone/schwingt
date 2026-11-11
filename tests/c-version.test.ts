import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addLyrics, lyricLength, lyricSlots } from '../src/model/lyrics';
import { parseMusicXml, parseXml } from '../src/model/musicxml';
import { Timeline } from '../src/model/timeline';
import type { NoteEvent } from '../src/model/types';

// scripts/make-c-fanfangxiang.mjs 生成的谱子：改了编配之后，这里守住几条不该变的性质
const xml = readFileSync(resolve(__dirname, '../public/scores/fanfangxiang-de-zhong-c.musicxml'), 'utf8');

describe('反方向的钟 C 调版', () => {
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

  it('67 小节，C 大调，两只手分在中央 C 两边', () => {
    expect(score.measures).toHaveLength(67);
    for (const m of score.measures) expect([m.duration, m.fifths]).toEqual([4, 0]);
    expect(Math.min(...right.map((n) => n.midi))).toBeGreaterThanOrEqual(60);
    expect(Math.max(...left.map((n) => n.midi))).toBeLessThanOrEqual(60);
  });

  it('黑键只有升 sol 和升 fa，只出现在导歌和进副歌前那几小节', () => {
    const black = score.notes.filter((n) => n.alter !== 0);
    expect(new Set(black.map((n) => `${n.step}${n.alter}`))).toEqual(new Set(['G1', 'F1']));
    const bars = new Set(black.map((n) => n.measure + 1));
    expect([...bars].sort((a, b) => a - b)).toEqual([13, 14, 15, 16, 17, 19, 20, 41, 42, 43, 44, 45, 47, 48]);
    // 导歌的低音半音下行：升 sol、sol｜升 fa、fa
    const bass = (bar: number): number[] => left.filter((n) => n.measure === bar - 1 && (n.start === 0 || n.start === 2)).map((n) => n.midi);
    expect([...bass(13), ...bass(14)]).toEqual([44, 43, 42, 41]);
    // 第三句旋律里的升 sol
    expect(right.filter((n) => n.measure === 15).map((n) => n.midi).slice(0, 4)).toEqual([69, 71, 68, 69]);
  });

  it('重复的段落一个音都不差', () => {
    // 导歌和进副歌前的铺垫
    expect(shape(right, 41, 48)).toEqual(shape(right, 13, 20));
    expect(shape(left, 41, 48)).toEqual(shape(left, 13, 20));
    // 副歌
    expect(shape(right, 49, 56)).toEqual(shape(right, 21, 28));
    expect(shape(left, 49, 63)).toEqual(shape(left, 21, 35));
    // 高八度的副歌：右手整段高八度，左手不变（最后一句的长音两遍收得不一样长，不比）
    expect(shape(right, 29, 34)).toEqual(shape(right, 21, 26, 12));
    expect(shape(left, 29, 35)).toEqual(shape(left, 21, 27));
  });

  it('右手同时最多两个音，只有进副歌前的重音小节是三个音的厚和弦', () => {
    const size = new Map<string, number>();
    for (const n of right) size.set(`${n.measure}:${n.start}`, (size.get(`${n.measure}:${n.start}`) ?? 0) + 1);
    const thick = new Set([...size].filter(([, count]) => count > 2).map(([key]) => Number(key.split(':')[0]) + 1));
    expect([...thick]).toEqual([20, 48]);
  });

  it('力度：前奏最轻，导歌渐强到重音小节最响，副歌比主歌响，间奏和尾奏轻下来', () => {
    expect(loudest(1)).toBeLessThan(loudest(5));
    expect(loudest(5)).toBeLessThan(loudest(13));
    expect(loudest(17)).toBeLessThan(loudest(18));
    expect(loudest(18)).toBeLessThan(loudest(19));
    expect(loudest(19)).toBeLessThan(loudest(20));
    expect(loudest(20)).toBe(Math.max(...right.map((n) => n.level ?? 1)));
    expect(loudest(21)).toBeGreaterThan(loudest(5) * 1.4);
    expect(loudest(29)).toBeGreaterThan(loudest(21));
    expect(loudest(37)).toBeLessThan(loudest(5));
    expect(loudest(67)).toBeLessThan(loudest(1));
    // 右手和弦里旋律以外的音比旋律轻
    const first = right.filter((n) => n.measure === 20 && n.start === 0).sort((a, b) => b.midi - a.midi);
    expect(first[1].level!).toBeLessThan(first[0].level!);
  });

  it('重音小节左手是八度，踏板一拍一换；结尾渐慢', () => {
    const hit = (beat: number): number[] =>
      left
        .filter((n) => n.measure === 19 && n.start === beat)
        .map((n) => n.midi)
        .sort((a, b) => a - b);
    expect([hit(0), hit(1), hit(2), hit(3)]).toEqual([
      [44, 56],
      [40, 52],
      [41, 53],
      [40, 52],
    ]);
    expect(score.measures[19].pedals).toEqual([
      { offset: 0, type: 'change' },
      { offset: 1, type: 'change' },
      { offset: 2, type: 'change' },
      { offset: 3, type: 'change' },
      { offset: 4, type: 'stop' },
    ]);
    for (const [down, up] of new Timeline(score).pedals) expect(up - down).toBeLessThanOrEqual(4 + 1e-9);
    expect(score.measures[65].tempos.map((t) => t.bpm)).toEqual([80, 70]);
    expect(score.measures[66].tempos.map((t) => t.bpm)).toEqual([58]);
  });

  it('歌词位置：162 个字，重复的段落用同一段歌词', () => {
    const doc = parseXml(xml);
    const slots = lyricSlots(doc);
    expect(lyricLength(slots)).toBe(162);
    // 主歌 65、导歌 33、副歌两段各 32；导歌和副歌各出现两遍
    expect(slots).toHaveLength(65 + 2 * (33 + 32 + 32));
    const at = (bar: number): number[] => slots.filter((s) => s.measure === String(bar)).map((s) => s.index);
    expect(at(41)).toEqual(at(13));
    expect(at(49)).toEqual(at(21));
    expect(at(57)).toEqual(at(29));
    // 每个位置上都有一个不是连线延续过来的旋律音，字都能写上去
    const tokens = Array.from({ length: 162 }, (_, i) => `字${i}`);
    expect(addLyrics(doc, tokens)).toBe(slots.length);
  });
});
