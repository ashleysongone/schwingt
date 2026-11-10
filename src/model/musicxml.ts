import { Measure, NoteEvent, PedalType, Score, Track, toMidi } from './types';

/** 装饰音没有时值，播放时给它一个很短的长度 */
export const GRACE_DUR = 0.125;
const DEFAULT_BEATS = 4;
const DEFAULT_BEAT_TYPE = 4;

export function kids(el: Element, name: string): Element[] {
  const out: Element[] = [];
  for (const c of Array.from(el.children)) if (c.tagName === name) out.push(c);
  return out;
}

export function kid(el: Element, name: string): Element | undefined {
  for (const c of Array.from(el.children)) if (c.tagName === name) return c;
  return undefined;
}

export function text(el: Element | undefined | null): string {
  return (el?.textContent ?? '').trim();
}

export function num(el: Element | undefined | null, fallback = 0): number {
  const v = parseFloat(text(el));
  return Number.isFinite(v) ? v : fallback;
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('文件不是有效的 XML，无法读取');
  }
  return doc;
}

/** 每个声部占几行谱表。钢琴通常是一个声部两行。 */
export function stavesOfPart(part: Element): number {
  let staves = 1;
  for (const el of Array.from(part.getElementsByTagName('staves'))) {
    staves = Math.max(staves, Math.round(num(el, 1)));
  }
  for (const el of Array.from(part.getElementsByTagName('staff'))) {
    if (el.parentElement?.tagName === 'note') staves = Math.max(staves, Math.round(num(el, 1)));
  }
  return staves;
}

const BEAT_UNIT: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
};

interface PartState {
  divisions: number;
  beats: number;
  beatType: number;
  fifths: number;
  mode?: string;
}

function emptyMeasure(index: number): Measure {
  return {
    index,
    number: String(index + 1),
    duration: 0,
    nominal: 4,
    beats: DEFAULT_BEATS,
    beatType: DEFAULT_BEAT_TYPE,
    fifths: 0,
    implicit: false,
    repeatStart: false,
    repeatEnd: 0,
    endingStop: false,
    tempos: [],
    pedals: [],
  };
}

export function parseMusicXml(input: string | Document): Score {
  const doc = typeof input === 'string' ? parseXml(input) : input;
  const root = doc.documentElement;
  if (root.tagName !== 'score-partwise') {
    throw new Error(
      root.tagName === 'score-timewise'
        ? '暂不支持 score-timewise 格式的 MusicXML'
        : '这不是 MusicXML 文件',
    );
  }

  const work = kid(root, 'work');
  let title = text(work && kid(work, 'work-title')) || text(kid(root, 'movement-title'));
  if (!title) {
    const credit = kid(root, 'credit');
    title = text(credit && kid(credit, 'credit-words'));
  }
  let composer = '';
  const ident = kid(root, 'identification');
  if (ident) {
    const creators = kids(ident, 'creator');
    composer = text(creators.find((c) => c.getAttribute('type') === 'composer') ?? creators[0]);
  }

  const partNames = new Map<string, string>();
  const partList = kid(root, 'part-list');
  if (partList) {
    for (const sp of kids(partList, 'score-part')) {
      partNames.set(sp.getAttribute('id') ?? '', text(kid(sp, 'part-name')));
    }
  }

  const parts = kids(root, 'part');
  const tracks: Track[] = [];
  const trackOffsets: number[] = [];
  const stavesPerPart: number[] = [];
  for (const part of parts) {
    const staves = stavesOfPart(part);
    trackOffsets.push(tracks.length);
    stavesPerPart.push(staves);
    const id = part.getAttribute('id') ?? '';
    for (let s = 1; s <= staves; s++) {
      tracks.push({ index: tracks.length, partId: id, staff: s, name: partNames.get(id) ?? '' });
    }
  }
  nameTracks(tracks, stavesPerPart);

  const measures: Measure[] = [];
  const notes: NoteEvent[] = [];

  parts.forEach((part, partIndex) => {
    const st: PartState = {
      divisions: 1,
      beats: DEFAULT_BEATS,
      beatType: DEFAULT_BEAT_TYPE,
      fifths: 0,
    };
    const openTies = new Map<number, NoteEvent>();
    const trackOffset = trackOffsets[partIndex];
    const staves = stavesPerPart[partIndex];

    kids(part, 'measure').forEach((mel, index) => {
      const isNew = index >= measures.length;
      const m = isNew ? emptyMeasure(index) : measures[index];
      if (isNew) {
        measures.push(m);
        m.number = mel.getAttribute('number') ?? String(index + 1);
        m.implicit = mel.getAttribute('implicit') === 'yes';
      }

      // 小节内的位置用 divisions 计整数，避免小数累加误差
      let pos = 0;
      let maxPos = 0;
      let chordStart = 0;
      const q = (div: number): number => div / st.divisions;

      const handleSound = (sound: Element, at: number, allowPedal: boolean): boolean => {
        let hadTempo = false;
        const tempo = parseFloat(sound.getAttribute('tempo') ?? '');
        if (Number.isFinite(tempo) && tempo > 0) {
          m.tempos.push({ offset: at, bpm: tempo });
          hadTempo = true;
        }
        if (allowPedal) {
          const dp = sound.getAttribute('damper-pedal');
          if (dp === 'yes') m.pedals.push({ offset: at, type: 'start' });
          else if (dp === 'no') m.pedals.push({ offset: at, type: 'stop' });
        }
        if (sound.hasAttribute('segno')) m.segno = true;
        if (sound.hasAttribute('coda')) m.coda = true;
        if (sound.getAttribute('dacapo') === 'yes') m.dacapo = true;
        if (sound.hasAttribute('dalsegno')) m.dalsegno = true;
        if (sound.hasAttribute('tocoda')) m.tocoda = true;
        if (sound.hasAttribute('fine')) m.fine = true;
        return hadTempo;
      };

      for (const el of Array.from(mel.children)) {
        switch (el.tagName) {
          case 'attributes': {
            const div = kid(el, 'divisions');
            if (div) st.divisions = num(div, st.divisions) || st.divisions;
            const key = kid(el, 'key');
            if (key) {
              st.fifths = Math.round(num(kid(key, 'fifths')));
              st.mode = text(kid(key, 'mode')) || undefined;
            }
            const time = kid(el, 'time');
            if (time) {
              const beats = text(kid(time, 'beats'))
                .split('+')
                .reduce((a, x) => a + (parseFloat(x) || 0), 0);
              if (beats > 0) {
                st.beats = beats;
                st.beatType = num(kid(time, 'beat-type'), 4) || 4;
              }
            }
            break;
          }
          case 'note': {
            const isChord = !!kid(el, 'chord');
            const isGrace = !!kid(el, 'grace');
            const durDiv = isGrace ? 0 : num(kid(el, 'duration'));
            const startDiv = isChord ? chordStart : pos;
            if (!isChord) {
              chordStart = pos;
              pos += durDiv;
              if (pos > maxPos) maxPos = pos;
            }
            const pitch = kid(el, 'pitch');
            if (!pitch || kid(el, 'cue')) break;

            const step = text(kid(pitch, 'step')).toUpperCase();
            const alter = Math.round(num(kid(pitch, 'alter')));
            const octave = Math.round(num(kid(pitch, 'octave'), 4));
            if (!/^[A-G]$/.test(step)) break;
            const midi = toMidi(step, alter, octave);
            const staff = Math.min(Math.max(Math.round(num(kid(el, 'staff'), 1)), 1), staves);

            const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
            const notations = kid(el, 'notations');
            if (!ties.length && notations) {
              for (const t of kids(notations, 'tied')) ties.push(t.getAttribute('type'));
            }
            const open = openTies.get(midi);
            if (ties.includes('stop') && open) {
              open.dur += q(durDiv);
              if (!ties.includes('start')) openTies.delete(midi);
              break;
            }

            const technical = notations && kid(notations, 'technical');
            const fingering = text(technical && kid(technical, 'fingering')) || undefined;
            const note: NoteEvent = {
              id: 0,
              track: trackOffset + staff - 1,
              midi,
              step,
              alter,
              octave,
              measure: index,
              start: q(startDiv),
              dur: isGrace ? GRACE_DUR : q(durDiv),
              voice: text(kid(el, 'voice')) || '1',
              grace: isGrace,
              fingering,
            };
            notes.push(note);
            if (ties.includes('start')) openTies.set(midi, note);
            break;
          }
          case 'backup':
            pos = Math.max(0, pos - num(kid(el, 'duration')));
            break;
          case 'forward':
            pos += num(kid(el, 'duration'));
            if (pos > maxPos) maxPos = pos;
            break;
          case 'direction': {
            const at = Math.max(0, q(pos + num(kid(el, 'offset'))));
            let hasPedalEl = false;
            let metronomeBpm = 0;
            for (const dt of kids(el, 'direction-type')) {
              const ped = kid(dt, 'pedal');
              if (ped) {
                hasPedalEl = true;
                const type = ped.getAttribute('type');
                if (type === 'start' || type === 'stop' || type === 'change') {
                  m.pedals.push({ offset: at, type: type as PedalType });
                }
              }
              const met = kid(dt, 'metronome');
              if (met) {
                const unit = BEAT_UNIT[text(kid(met, 'beat-unit'))] ?? 1;
                const dotted = kid(met, 'beat-unit-dot') ? 1.5 : 1;
                const perMin = parseFloat((text(kid(met, 'per-minute')).match(/[\d.]+/) ?? [''])[0]);
                if (perMin > 0) metronomeBpm = perMin * unit * dotted;
              }
            }
            const sound = kid(el, 'sound');
            const hadTempo = sound ? handleSound(sound, at, !hasPedalEl) : false;
            if (!hadTempo && metronomeBpm > 0) m.tempos.push({ offset: at, bpm: metronomeBpm });
            break;
          }
          case 'sound':
            handleSound(el, Math.max(0, q(pos + num(kid(el, 'offset')))), true);
            break;
          case 'barline': {
            const rep = kid(el, 'repeat');
            if (rep) {
              const dir = rep.getAttribute('direction');
              if (dir === 'forward') m.repeatStart = true;
              else if (dir === 'backward') {
                m.repeatEnd = Math.max(2, parseInt(rep.getAttribute('times') ?? '2', 10) || 2);
              }
            }
            const ending = kid(el, 'ending');
            if (ending) {
              const type = ending.getAttribute('type');
              if (type === 'start') {
                const nums = (ending.getAttribute('number') ?? '')
                  .split(/[,\s]+/)
                  .map((s) => parseInt(s, 10))
                  .filter((n) => n > 0);
                m.endingStart = nums.length ? nums : [1];
              } else if (type === 'stop' || type === 'discontinue') {
                m.endingStop = true;
              }
            }
            break;
          }
        }
      }

      if (isNew) {
        m.beats = st.beats;
        m.beatType = st.beatType;
        m.fifths = st.fifths;
        m.mode = st.mode;
        m.nominal = (st.beats * 4) / st.beatType;
      }
      const dur = maxPos > 0 ? q(maxPos) : m.nominal;
      m.duration = Math.max(m.duration, dur);
    });
  });

  if (!measures.length) throw new Error('谱子里没有小节');
  const first = measures[0];
  if (first.duration < first.nominal - 1e-6) first.implicit = true;

  for (const m of measures) {
    m.tempos.sort((a, b) => a.offset - b.offset);
    m.pedals.sort((a, b) => a.offset - b.offset);
  }
  // 稳定排序：同一位置的音符保持谱面里的先后（连续装饰音靠这个顺序）
  notes.sort((a, b) => a.measure - b.measure || a.start - b.start || a.track - b.track);
  notes.forEach((n, i) => (n.id = i));

  return { title, composer, tracks, measures, notes };
}

function nameTracks(tracks: Track[], stavesPerPart: number[]): void {
  if (tracks.length === 1) {
    tracks[0].name = '右手';
    return;
  }
  if (tracks.length === 2) {
    tracks[0].name = '右手';
    tracks[1].name = '左手';
    return;
  }
  let partIndex = -1;
  let lastPartId: string | undefined;
  tracks.forEach((t, i) => {
    if (t.partId !== lastPartId) {
      partIndex++;
      lastPartId = t.partId;
    }
    const base = t.name || `声部 ${partIndex + 1}`;
    if (stavesPerPart[partIndex] === 2) t.name = `${base} ${t.staff === 1 ? '右手' : '左手'}`;
    else if (stavesPerPart[partIndex] > 2) t.name = `${base} 第 ${t.staff} 行`;
    else t.name = base || `谱表 ${i + 1}`;
  });
}
