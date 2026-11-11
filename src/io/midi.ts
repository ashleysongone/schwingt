/** 标准 MIDI 文件（.mid）的读取。只取练琴用得上的内容：音符、速度、拍号、调号、延音踏板、段落标记。 */

export interface MidiNote {
  tick: number;
  dur: number;
  midi: number;
  velocity: number;
  channel: number;
  track: number;
}

export interface MidiFile {
  format: number;
  /** 每个四分音符多少 tick */
  ppq: number;
  trackNames: string[];
  notes: MidiNote[];
  tempos: { tick: number; bpm: number }[];
  timeSigs: { tick: number; beats: number; beatType: number }[];
  keySigs: { tick: number; fifths: number; minor: boolean }[];
  pedals: { tick: number; down: boolean }[];
  /** 写在曲子里的文字：marker 是段落名（前奏、副歌……），cue 是演奏提示（渐强……） */
  texts: { tick: number; text: string; kind: 'marker' | 'cue' }[];
}

export function isMidi(data: ArrayBuffer): boolean {
  const b = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  return b.length === 4 && b[0] === 0x4d && b[1] === 0x54 && b[2] === 0x68 && b[3] === 0x64;
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    // 老的中文 MIDI 常用 GBK 写音轨名
    try {
      return new TextDecoder('gbk').decode(bytes).trim();
    } catch {
      return '';
    }
  }
}

export function parseMidi(data: ArrayBuffer): MidiFile {
  if (!isMidi(data)) throw new Error('这不是 MIDI 文件');
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  let p = 8;
  const headerLen = view.getUint32(4);
  const format = view.getUint16(p);
  const trackCount = view.getUint16(p + 2);
  const division = view.getUint16(p + 4);
  p += headerLen;
  if (division & 0x8000) throw new Error('暂不支持按时间码计时的 MIDI');

  const file: MidiFile = {
    format,
    ppq: division || 480,
    trackNames: [],
    notes: [],
    tempos: [],
    timeSigs: [],
    keySigs: [],
    pedals: [],
    texts: [],
  };

  const readVar = (end: number): number => {
    let v = 0;
    while (p < end) {
      const b = bytes[p++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };

  for (let t = 0; t < trackCount && p + 8 <= bytes.length; t++) {
    const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    const len = view.getUint32(p + 4);
    p += 8;
    const end = Math.min(p + len, bytes.length);
    if (id !== 'MTrk') {
      p = end;
      t--;
      continue;
    }

    let tick = 0;
    let status = 0;
    let name = '';
    /** 还按着的音：键是 通道×128+音高 */
    const held = new Map<number, { tick: number; velocity: number }[]>();
    const release = (key: number, at: number): void => {
      const start = held.get(key)?.shift();
      if (!start) return;
      file.notes.push({
        tick: start.tick,
        dur: Math.max(1, at - start.tick),
        midi: key & 0x7f,
        velocity: start.velocity,
        channel: key >> 7,
        track: t,
      });
    };

    while (p < end) {
      tick += readVar(end);
      if (p >= end) break;
      if (bytes[p] & 0x80) status = bytes[p++];
      if (status === 0xff) {
        const type = bytes[p++];
        const n = readVar(end);
        const body = bytes.subarray(p, Math.min(p + n, end));
        if (type === 0x03 && !name) name = decodeText(body);
        else if (type === 0x06 || type === 0x07) {
          const text = decodeText(body);
          if (text) file.texts.push({ tick, text, kind: type === 0x06 ? 'marker' : 'cue' });
        } else if (type === 0x51 && body.length >= 3) {
          const us = (body[0] << 16) | (body[1] << 8) | body[2];
          if (us > 0) file.tempos.push({ tick, bpm: 60_000_000 / us });
        } else if (type === 0x58 && body.length >= 2) {
          file.timeSigs.push({ tick, beats: body[0] || 4, beatType: 2 ** body[1] });
        } else if (type === 0x59 && body.length >= 2) {
          file.keySigs.push({ tick, fifths: (body[0] << 24) >> 24, minor: body[1] === 1 });
        }
        p += n;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVar(end);
      } else if (status >= 0x80) {
        const kind = status & 0xf0;
        const channel = status & 0x0f;
        const d1 = bytes[p++] & 0x7f;
        const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[p++] & 0x7f;
        const key = (channel << 7) | d1;
        if (kind === 0x90 && d2 > 0) {
          let list = held.get(key);
          if (!list) held.set(key, (list = []));
          list.push({ tick, velocity: d2 });
        } else if (kind === 0x80 || kind === 0x90) {
          release(key, tick);
        } else if (kind === 0xb0 && d1 === 64) {
          file.pedals.push({ tick, down: d2 >= 64 });
        }
      } else {
        // 数据坏了，放弃这条音轨剩下的部分
        break;
      }
    }
    for (const [key, list] of held) while (list.length) release(key, tick);
    file.trackNames[t] = name;
    p = end;
  }

  file.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  file.tempos.sort((a, b) => a.tick - b.tick);
  file.timeSigs.sort((a, b) => a.tick - b.tick);
  file.keySigs.sort((a, b) => a.tick - b.tick);
  file.pedals.sort((a, b) => a.tick - b.tick);
  file.texts.sort((a, b) => a.tick - b.tick);
  return file;
}
