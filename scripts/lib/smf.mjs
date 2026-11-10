// 最小的 MIDI 读写，给 scripts 里的小工具用（应用本身的 MIDI 读取在 src/io/midi.ts）
import { readFileSync, writeFileSync } from 'node:fs';

export function readMidi(path) {
  const bytes = new Uint8Array(readFileSync(path));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8 + view.getUint32(4);
  const ppq = view.getUint16(12);
  const trackCount = view.getUint16(10);
  const notes = [];
  const tempos = [];
  const readVar = (end) => {
    let v = 0;
    while (p < end) {
      const b = bytes[p++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };
  for (let t = 0; t < trackCount && p + 8 <= bytes.length; t++) {
    const len = view.getUint32(p + 4);
    p += 8;
    const end = p + len;
    let tick = 0;
    let status = 0;
    const held = new Map();
    while (p < end) {
      tick += readVar(end);
      if (bytes[p] & 0x80) status = bytes[p++];
      if (status === 0xff) {
        const type = bytes[p++];
        const n = readVar(end);
        if (type === 0x51) tempos.push({ tick, bpm: 60e6 / ((bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]) });
        p += n;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVar(end);
      } else {
        const kind = status & 0xf0;
        const d1 = bytes[p++];
        const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[p++];
        if (kind === 0x90 && d2 > 0) {
          if (!held.has(d1)) held.set(d1, []);
          held.get(d1).push({ tick, vel: d2 });
        } else if (kind === 0x80 || kind === 0x90) {
          const s = held.get(d1)?.shift();
          if (s) notes.push({ tick: s.tick, dur: tick - s.tick, midi: d1, vel: s.vel, track: t });
        }
      }
    }
    p = end;
  }
  notes.sort((a, b) => a.tick - b.tick || b.midi - a.midi);
  return { ppq, notes, tempos };
}

const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};

function trackBytes(events) {
  // 同一时刻：order 小的在前（松键、抬踏板先于按键）
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.tick - b.e.tick || (a.e.order ?? 1) - (b.e.order ?? 1) || a.i - b.i);
  const body = [];
  let last = 0;
  for (const { e } of sorted) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...body];
}

/** tracks：每条音轨是事件数组 { tick, bytes, order? } */
export function writeMidi(path, ppq, tracks) {
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (ppq >> 8) & 0xff, ppq & 0xff];
  writeFileSync(path, new Uint8Array([...head, ...tracks.flatMap(trackBytes)]));
}

export const noteOn = (tick, midi, velocity = 80) => ({ tick, bytes: [0x90, midi, velocity], order: 2 });
export const noteOff = (tick, midi) => ({ tick, bytes: [0x80, midi, 0], order: 0 });
export const pedal = (tick, down) => ({ tick, bytes: [0xb0, 64, down ? 127 : 0], order: down ? 3 : 0 });
export const trackName = (text) => {
  const b = Array.from(new TextEncoder().encode(text));
  return { tick: 0, bytes: [0xff, 0x03, b.length, ...b], order: -1 };
};
export const tempo = (tick, bpm) => {
  const us = Math.round(60e6 / bpm);
  return { tick, bytes: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff], order: -1 };
};
export const timeSignature = (tick, beats, power) => ({ tick, bytes: [0xff, 0x58, 4, beats, power, 24, 8], order: -1 });
export const keySignature = (tick, fifths) => ({ tick, bytes: [0xff, 0x59, 2, fifths & 0xff, 0], order: -1 });

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
