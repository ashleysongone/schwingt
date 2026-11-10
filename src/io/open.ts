import { midiToMusicXml } from '../model/fromMidi';
import { parseMusicXml, parseXml } from '../model/musicxml';
import { Score } from '../model/types';
import { readMusicXml } from './files';
import { isMidi, parseMidi } from './midi';

export interface OpenedScore {
  /** 用来显示的谱子 */
  doc: Document;
  /** 用来播放的音符数据 */
  score: Score;
  /** 五线谱是从 MIDI 自动转出来的，不是原本就有的 */
  generated: boolean;
  warnings: string[];
}

/**
 * 把一份谱子文件（MusicXML 或 MIDI）读成可以显示和播放的数据。
 * MIDI 里通常没有曲名和作曲者，可以由 meta 补上。
 */
export function interpret(data: ArrayBuffer, name: string, meta: { title?: string; composer?: string } = {}): OpenedScore {
  if (!isMidi(data)) {
    const doc = parseXml(readMusicXml(data, name));
    return { doc, score: parseMusicXml(doc), generated: false, warnings: [] };
  }

  const title = meta.title || name.replace(/\.[^.]+$/, '');
  const conv = midiToMusicXml(parseMidi(data), title, meta.composer);
  const doc = parseXml(conv.xml);
  const score = parseMusicXml(doc);
  // 谱面上为了好认把一些音记短了，播放时还按 MIDI 里实际按住的长度
  for (const n of score.notes) {
    const full = conv.durations.get(`${n.track}:${n.measure}:${Math.round(n.start * 4)}:${n.midi}`);
    if (full) n.dur = full / 4;
  }
  return { doc, score, generated: true, warnings: conv.warnings };
}
