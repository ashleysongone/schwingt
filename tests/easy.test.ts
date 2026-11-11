import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../src/model/musicxml';
import { unroll } from '../src/model/sequence';
import { Timeline } from '../src/model/timeline';

// scripts/make-easy-fanfangxiang.mjs 生成的谱子：改了编配之后，这里守住几条不该变的性质
const xml = readFileSync(resolve(__dirname, '../public/scores/fanfangxiang-de-zhong-easy.musicxml'), 'utf8');

describe('反方向的钟 C 调入门版', () => {
  const score = parseMusicXml(xml);
  const right = score.notes.filter((n) => n.track === 0);
  const left = score.notes.filter((n) => n.track === 1);

  it('31 小节，每小节四拍，副歌反复一遍', () => {
    expect(score.measures).toHaveLength(31);
    for (const m of score.measures) expect(m.duration).toBe(4);
    expect(unroll(score.measures)).toHaveLength(39);
  });

  it('右手只有白键，两只手不交叉', () => {
    expect(right.every((n) => n.alter === 0)).toBe(true);
    expect(Math.min(...right.map((n) => n.midi))).toBeGreaterThan(Math.max(...left.map((n) => n.midi)));
  });

  it('副歌只用 do re mi sol la 五个音', () => {
    const chorus = right.filter((n) => n.measure >= 20 && n.measure <= 27);
    expect(new Set(chorus.map((n) => n.step))).toEqual(new Set(['C', 'D', 'E', 'G', 'A']));
  });

  it('踏板跟着和弦换，最长踩一小节', () => {
    const { pedals } = new Timeline(score);
    expect(pedals.length).toBeGreaterThan(40);
    for (const [down, up] of pedals) expect(up - down).toBeLessThanOrEqual(4 + 1e-9);
  });
});
