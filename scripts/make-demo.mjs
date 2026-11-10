// 生成自带的示例曲《小星星》（传统旋律，公有领域）。
// 用法：node scripts/make-demo.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/scores/twinkle.musicxml');

const DIV = 2; // 每个四分音符分成 2 份
const TYPES = { 1: 'eighth', 2: 'quarter', 4: 'half', 8: 'whole' };

/** 'C4' -> { step, octave } */
function pitch(name) {
  return { step: name[0], octave: Number(name.slice(1)) };
}

function noteXml({ name, dur, staff, voice, chord = false, finger, beam }) {
  const p = pitch(name);
  return [
    '      <note>',
    chord ? '        <chord/>' : '',
    `        <pitch><step>${p.step}</step><octave>${p.octave}</octave></pitch>`,
    `        <duration>${dur}</duration>`,
    `        <voice>${voice}</voice>`,
    `        <type>${TYPES[dur]}</type>`,
    `        <staff>${staff}</staff>`,
    beam ? `        <beam number="1">${beam}</beam>` : '',
    finger ? `        <notations><technical><fingering>${finger}</fingering></technical></notations>` : '',
    '      </note>',
  ]
    .filter(Boolean)
    .join('\n');
}

function pedalXml(type) {
  return [
    '      <direction placement="below">',
    `        <direction-type><pedal type="${type}" line="yes"/></direction-type>`,
    '        <staff>2</staff>',
    '      </direction>',
  ].join('\n');
}

// 右手旋律：[音名, 时值, 指法]
const A = [
  [['C4', 2, 1], ['C4', 2, 1], ['G4', 2, 4], ['G4', 2, 4]],
  [['A4', 2, 5], ['A4', 2, 5], ['G4', 4, 4]],
  [['F4', 2, 4], ['F4', 2, 4], ['E4', 2, 3], ['E4', 2, 3]],
  [['D4', 2, 2], ['D4', 2, 2], ['C4', 4, 1]],
];
const B = [
  [['G4', 2, 5], ['G4', 2, 5], ['F4', 2, 4], ['F4', 2, 4]],
  [['E4', 2, 3], ['E4', 2, 3], ['D4', 4, 2]],
];
const right = [...A, ...B, ...B, ...A];

// 左手分解和弦，每半小节一个和弦
const CHORD = {
  C: ['C3', 'G3', 'E3', 'G3'],
  F: ['C3', 'A3', 'F3', 'A3'],
  G: ['B2', 'G3', 'D3', 'G3'],
};
const LA = [['C', 'C'], ['F', 'C'], ['F', 'C'], ['G', 'C']];
const LB = [['C', 'F'], ['C', 'G']];
const left = [...LA, ...LB, ...LB, ...LA];

const measures = right.map((rh, i) => {
  const last = i === right.length - 1;
  const lines = [`    <measure number="${i + 1}">`];
  if (i === 0) {
    lines.push(
      '      <attributes>',
      `        <divisions>${DIV}</divisions>`,
      '        <key><fifths>0</fifths><mode>major</mode></key>',
      '        <time><beats>4</beats><beat-type>4</beat-type></time>',
      '        <staves>2</staves>',
      '        <clef number="1"><sign>G</sign><line>2</line></clef>',
      '        <clef number="2"><sign>F</sign><line>4</line></clef>',
      '      </attributes>',
      '      <direction placement="above">',
      '        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type>',
      '        <staff>1</staff>',
      '        <sound tempo="100"/>',
      '      </direction>',
    );
  }
  for (const [name, dur, finger] of rh) lines.push(noteXml({ name, dur, staff: 1, voice: 1, finger }));
  lines.push(`      <backup><duration>${4 * DIV}</duration></backup>`);

  left[i].forEach((chordName, half) => {
    lines.push(pedalXml(i === 0 && half === 0 ? 'start' : 'change'));
    if (last && half === 1) {
      // 最后半小节收在一个柱式和弦上
      ['C3', 'E3', 'G3'].forEach((name, k) => {
        lines.push(noteXml({ name, dur: 4, staff: 2, voice: 5, chord: k > 0 }));
      });
      return;
    }
    CHORD[chordName].forEach((name, k) => {
      const beam = k === 0 ? 'begin' : k === 3 ? 'end' : 'continue';
      lines.push(noteXml({ name, dur: 1, staff: 2, voice: 5, beam }));
    });
  });
  if (last) {
    lines.push(pedalXml('stop'));
    lines.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
  }
  lines.push('    </measure>');
  return lines.join('\n');
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>小星星</work-title></work>
  <identification>
    <creator type="composer">传统儿歌</creator>
    <encoding><software>schwingt make-demo</software></encoding>
  </identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
${measures.join('\n')}
  </part>
</score-partwise>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, xml, 'utf8');
console.log(`已生成 ${out}（${right.length} 小节）`);
