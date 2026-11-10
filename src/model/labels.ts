import { kid, kids, num, stavesOfPart, text } from './musicxml';
import { LabelMode, labelFor } from './solfege';
import { toMidi } from './types';

export interface LabelOptions {
  mode: LabelMode;
  /** 要标唱名的谱表序号 */
  tracks: Set<number>;
}

function isTieStop(note: Element): boolean {
  if (kids(note, 'tie').some((t) => t.getAttribute('type') === 'stop')) return true;
  const notations = kid(note, 'notations');
  return !!notations && kids(notations, 'tied').some((t) => t.getAttribute('type') === 'stop');
}

/**
 * 返回一份带唱名的谱子副本，原文档不改动。
 * 唱名以歌词的形式写在音符下方。同一行谱表上同时起音的几个音
 * （和弦，或者不同声部碰在一起）从高到低排成几行，避免互相重叠。
 * 连音线延续过来的音、装饰音不标。
 */
export function withLabels(src: Document, opts: LabelOptions): Document {
  const doc = src.cloneNode(true) as Document;
  if (!opts.tracks.size) return doc;

  let trackOffset = 0;
  for (const part of kids(doc.documentElement, 'part')) {
    const staves = stavesOfPart(part);
    let fifths = 0;
    for (const measure of kids(part, 'measure')) {
      let pos = 0;
      let chordStart = 0;
      const groups = new Map<string, { anchor: Element; items: { midi: number; label: string }[] }>();

      for (const el of Array.from(measure.children)) {
        switch (el.tagName) {
          case 'attributes': {
            const key = kid(el, 'key');
            if (key) fifths = Math.round(num(kid(key, 'fifths')));
            break;
          }
          case 'backup':
            pos = Math.max(0, pos - num(kid(el, 'duration')));
            break;
          case 'forward':
            pos += num(kid(el, 'duration'));
            break;
          case 'note': {
            const isChord = !!kid(el, 'chord');
            const isGrace = !!kid(el, 'grace');
            const start = isChord ? chordStart : pos;
            if (!isChord) {
              chordStart = pos;
              if (!isGrace) pos += num(kid(el, 'duration'));
            }
            const staff = Math.min(Math.max(Math.round(num(kid(el, 'staff'), 1)), 1), staves);
            if (!opts.tracks.has(trackOffset + staff - 1)) break;

            for (const l of kids(el, 'lyric')) el.removeChild(l);
            const pitch = kid(el, 'pitch');
            if (!pitch || isGrace || kid(el, 'cue') || isTieStop(el)) break;
            const step = text(kid(pitch, 'step')).toUpperCase();
            if (!/^[A-G]$/.test(step)) break;
            const alter = Math.round(num(kid(pitch, 'alter')));
            const octave = Math.round(num(kid(pitch, 'octave'), 4));
            const midi = toMidi(step, alter, octave);

            const key = `${staff}:${start}`;
            let group = groups.get(key);
            if (!group) groups.set(key, (group = { anchor: el, items: [] }));
            if (!group.items.some((x) => x.midi === midi)) {
              group.items.push({ midi, label: labelFor(step, alter, fifths, opts.mode) });
            }
            break;
          }
        }
      }

      for (const { anchor, items } of groups.values()) {
        items.sort((a, b) => b.midi - a.midi);
        items.forEach((item, k) => {
          const lyric = doc.createElement('lyric');
          lyric.setAttribute('number', String(k + 1));
          const syllabic = doc.createElement('syllabic');
          syllabic.textContent = 'single';
          const t = doc.createElement('text');
          t.textContent = item.label;
          lyric.append(syllabic, t);
          anchor.appendChild(lyric);
        });
      }
    }
    trackOffset += staves;
  }
  return doc;
}
