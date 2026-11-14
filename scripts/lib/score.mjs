// 把手写的小节记号写成 MusicXML（两行谱表的钢琴谱）。给 scripts 里手工编配的谱子用。
//
// 一个小节是一个对象：
//   rh / lh   右手、左手的音符。记法：音名:时值，时值以十六分音符为单位，一小节是 16。
//             后面可以跟 ~（和下一个同音高的音连起来）、/数字（指法）、^（延长记号）、_（这个音不对歌词）。
//             r 是休止，和弦用 + 连接，最高音写在前面。
//   chords    和弦标记，'F@0 G@8'：@ 后面是小节里的位置。支持 m、7、m7、m7b5、maj7、sus4、sus2 和 / 低音
//   pedal     踏板，'start@0 change@8 stop@16'
//   label     段落名（粗体）；cue 演奏提示（斜体）；dyn 力度记号（pp、p、mp、mf、f、ff），都写在小节开头
//   wedge     'crescendo' / 'diminuendo' 从这一小节开头画渐强、渐弱的开口线，'stop' 在这一小节开头结束
//   ottava    'start@12' 从这个位置起记成高八度（谱面低八度写、标 8va），'stop@16' 结束
//   tempo     播放速度变化，'80@0 72@8'
//   level     播放力度，1 是平常（中强）。写成 [从, 到] 就在这一小节里平滑过渡
//   sing      这一小节的旋律对歌词，值是歌词段落的名字；同名段落再次出现时用同一段歌词
//   repeat    'start' / 'end' 反复记号
// 整份谱子另有 key：调号，正数是几个升号，负数是几个降号，不写就是 C 大调。
import { writeFileSync } from 'node:fs';

/** 每个四分音符分成 4 份：时值 1 就是十六分音符 */
export const DIV = 4;
export const BAR = 16;
/** 时值 -> [音符类型, 是否带附点] */
const TYPE = {
  1: ['16th', false],
  2: ['eighth', false],
  3: ['eighth', true],
  4: ['quarter', false],
  6: ['quarter', true],
  8: ['half', false],
  12: ['half', true],
  16: ['whole', false],
};
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL = { '-1': 'flat', 0: 'natural', 1: 'sharp' };
const KIND = {
  '': ['major', ''],
  m: ['minor', 'm'],
  7: ['dominant', '7'],
  m7: ['minor-seventh', 'm7'],
  m7b5: ['half-diminished', 'm7♭5'],
  maj7: ['major-seventh', 'maj7'],
  sus4: ['suspended-fourth', 'sus4'],
  sus2: ['suspended-second', 'sus2'],
};
/** 力度倍数 1（中强）对应的 MusicXML dynamics 值：标准里 100 是“强”，中强约为它的九成 */
const MF = 89;
/** 右手和弦里旋律以外的音比旋律轻这么多 */
const INNER = 0.82;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

/** 去掉记号里的指法，重复的段落不用每次都标 */
export const plain = (s) => s.replace(/\/\d/g, '');
/** 整段升高一个八度 */
export const up = (s) => s.replace(/([A-G][#b]?)(\d)/g, (_, name, octave) => name + (Number(octave) + 1));

function parsePitch(name) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  return { step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) };
}
const pitchKey = (p) => `${p.step}${p.alter}${p.octave}`;
const midiOf = (p) => (p.octave + 1) * 12 + SEMITONE[p.step] + p.alter;

function parseHand(text, where) {
  let pos = 0;
  const items = text
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const m = /^(r|[A-G][#b]?\d(?:\+[A-G][#b]?\d)*):(\d+)(~?)(?:\/(\d))?(\^?)(_?)$/.exec(tok);
      if (!m) throw new Error(`${where}：看不懂的记号 ${tok}`);
      const dur = Number(m[2]);
      if (!TYPE[dur]) throw new Error(`${where}：时值 ${dur} 写不成一个音符（${tok}）`);
      const item = {
        pitches: m[1] === 'r' ? [] : m[1].split('+').map(parsePitch),
        dur,
        tie: m[3] === '~',
        finger: m[4],
        fermata: m[5] === '^',
        silent: m[6] === '_',
        pos,
      };
      pos += dur;
      return item;
    });
  if (pos !== BAR) throw new Error(`${where}：时值加起来是 ${pos}，应该是 ${BAR}`);
  return items;
}

/** 'F@0 G@8' -> [[位置, 名字]…]，按位置排好 */
function parseMarks(text = '') {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const [name, at] = tok.split('@');
      return [Number(at), name];
    })
    .sort((a, b) => a[0] - b[0]);
}

/** 符杠：同一拍里相邻的八分、十六分音符连在一起 */
function computeBeams(items) {
  const out = new Map();
  for (let beat = 0; beat < BAR; beat += DIV) {
    const short = items.filter((it) => it.pos >= beat && it.pos < beat + DIV && it.pitches.length && it.dur <= 3);
    // 只连挨着的：中间隔了休止或长音就各画各的
    const runs = [];
    for (const it of short) {
      const run = runs[runs.length - 1];
      const prev = run?.[run.length - 1];
      if (prev && prev.pos + prev.dur === it.pos) run.push(it);
      else runs.push([it]);
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      run.forEach((it, k) => {
        const beams = { 1: k === 0 ? 'begin' : k === run.length - 1 ? 'end' : 'continue' };
        if (it.dur === 1) {
          const before = k > 0 && run[k - 1].dur === 1;
          const after = k < run.length - 1 && run[k + 1].dur === 1;
          beams[2] = before && after ? 'continue' : after ? 'begin' : before ? 'end' : k > 0 ? 'backward hook' : 'forward hook';
        }
        out.set(it, beams);
      });
    }
  }
  return out;
}

function harmonyXml(name) {
  const m = /^([A-G])([#b]?)(m7b5|m7|maj7|sus4|sus2|m|7)?(?:\/([A-G])([#b]?))?$/.exec(name);
  if (!m) throw new Error(`看不懂的和弦名 ${name}`);
  const alter = (s) => (s === '#' ? 1 : -1);
  const [kind, text] = KIND[m[3] ?? ''];
  return [
    '      <harmony print-frame="no">',
    `        <root><root-step>${m[1]}</root-step>${m[2] ? `<root-alter>${alter(m[2])}</root-alter>` : ''}</root>`,
    `        <kind${text ? ` text="${text}"` : ''}>${kind}</kind>`,
    m[4] ? `        <bass><bass-step>${m[4]}</bass-step>${m[5] ? `<bass-alter>${alter(m[5])}</bass-alter>` : ''}</bass>` : '',
    '        <staff>1</staff>',
    '      </harmony>',
  ]
    .filter(Boolean)
    .join('\n');
}

const direction = (placement, staff, inner) =>
  [`      <direction placement="${placement}">`, `        <direction-type>${inner}</direction-type>`, `        <staff>${staff}</staff>`, '      </direction>'].join('\n');
const pedalXml = (type) => direction('below', 2, `<pedal type="${type}" line="yes"/>`);
const wordsXml = (text, style) => direction('above', 1, `<words ${style}>${text}</words>`);
const dynXml = (name) => direction('below', 1, `<dynamics><${name}/></dynamics>`);
const wedgeXml = (type) => direction('below', 1, `<wedge type="${type}" number="1"/>`);
// type="down" 的意思是谱面比实际音高低八度写，也就是平常说的 8va
const ottavaXml = (type) => direction('above', 1, `<octave-shift type="${type === 'start' ? 'down' : 'stop'}" size="8" number="1"/>`);

/** 调号里这个音名本来就带的升降：key 是升号（正）或降号（负）的个数 */
function keyAlter(key, step) {
  if (key > 0) return 'FCGDAEB'.indexOf(step) < key ? 1 : 0;
  if (key < 0) return 'BEADGCF'.indexOf(step) < -key ? -1 : 0;
  return 0;
}

/** 小节里某个位置的力度倍数 */
function levelAt(level, pos) {
  if (level === undefined) return undefined;
  return Array.isArray(level) ? level[0] + ((level[1] - level[0]) * pos) / BAR : level;
}

/** 一只手在一小节里的全部音符。state 跨小节保留：还没接上的连线、统计 */
function handXml(items, { staff, voice, before, state, where, level, key = 0 }) {
  const beams = computeBeams(items);
  const altered = new Map(); // 这一小节里已经出现过的升降：'G2' -> 1
  const lines = [];
  for (const it of items) {
    for (const xml of before.get(it.pos) ?? []) lines.push(xml);
    before.delete(it.pos);
    const [type, dotted] = TYPE[it.dur];
    if (!it.pitches.length) {
      if (state.open.size) throw new Error(`${where}：连线后面接的是休止`);
      lines.push(`      <note><rest/><duration>${it.dur}</duration><voice>${voice}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}<staff>${staff}</staff></note>`);
      continue;
    }
    const stops = new Set(it.pitches.map(pitchKey).filter((k) => state.open.has(k)));
    if (stops.size !== state.open.size) throw new Error(`${where}：连线后面的音高对不上`);
    it.tieStop = stops.size > 0;
    state.open = new Set(it.tie ? it.pitches.map(pitchKey) : []);
    const loud = levelAt(level, it.pos);
    it.pitches.forEach((p, k) => {
      const stop = stops.has(pitchKey(p));
      const slot = `${p.step}${p.octave}`;
      const shown = altered.get(slot) ?? keyAlter(key, p.step);
      const accidental = !stop && p.alter !== shown ? ACCIDENTAL[p.alter] : '';
      altered.set(slot, p.alter);
      const notations = [
        stop ? '<tied type="stop"/>' : '',
        it.tie ? '<tied type="start"/>' : '',
        it.finger && k === 0 ? `<technical><fingering>${it.finger}</fingering></technical>` : '',
        it.fermata && k === 0 ? '<fermata type="upright"/>' : '',
      ].join('');
      const beam = beams.get(it);
      const dynamics = loud === undefined ? '' : ` dynamics="${Math.round(loud * (k > 0 && staff === 1 ? INNER : 1) * MF)}"`;
      lines.push(
        [
          `      <note${dynamics}>`,
          k > 0 ? '<chord/>' : '',
          `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`,
          `<duration>${it.dur}</duration>`,
          stop ? '<tie type="stop"/>' : '',
          it.tie ? '<tie type="start"/>' : '',
          `<voice>${voice}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}`,
          accidental ? `<accidental>${accidental}</accidental>` : '',
          `<staff>${staff}</staff>`,
          beam ? Object.entries(beam).map(([n, v]) => `<beam number="${n}">${v}</beam>`).join('') : '',
          notations ? `<notations>${notations}</notations>` : '',
          '</note>',
        ].join(''),
      );
      state.notes.push(midiOf(p));
    });
  }
  // 记在小节末尾的记号（抬踏板、8va 结束）
  for (const xml of before.get(BAR) ?? []) lines.push(xml);
  before.delete(BAR);
  if (before.size) throw new Error(`${where}：位置 ${[...before.keys()].join('、')} 上没有音符，记号放不上去`);
  return lines.join('\n');
}

/** 把几种记号按位置合成一张表：位置 -> [xml…] */
function collect(...lists) {
  const map = new Map();
  for (const [pos, xml] of lists.flat()) {
    if (!map.has(pos)) map.set(pos, []);
    map.get(pos).push(xml);
  }
  return map;
}

/**
 * @param {{ title: string, composer: string, software: string, tempo: number, key?: number, bars: object[] }} spec
 * @returns {{ xml: string, summary: string, slots: number }}
 */
export function buildScore({ title, composer, software, tempo, key = 0, bars }) {
  const right = { open: new Set(), notes: [] };
  const left = { open: new Set(), notes: [] };
  /** 歌词位置：{ bar, pos, part, k }，k 是它在自己那一段歌词里是第几个字 */
  const slots = [];
  const counters = new Map();
  const partLength = new Map();

  const measures = bars.map((bar, i) => {
    const where = `第 ${i + 1} 小节`;
    const lines = [`    <measure number="${i + 1}">`];
    if (bar.repeat === 'start') lines.push('      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
    if (i === 0) {
      lines.push(
        '      <attributes>',
        `        <divisions>${DIV}</divisions>`,
        `        <key><fifths>${key}</fifths><mode>major</mode></key>`,
        '        <time><beats>4</beats><beat-type>4</beat-type></time>',
        '        <staves>2</staves>',
        '        <clef number="1"><sign>G</sign><line>2</line></clef>',
        '        <clef number="2"><sign>F</sign><line>4</line></clef>',
        '      </attributes>',
        '      <direction placement="above">',
        `        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type>`,
        '        <staff>1</staff>',
        `        <sound tempo="${tempo}"/>`,
        '      </direction>',
      );
    }
    if (bar.label) lines.push(wordsXml(bar.label, 'font-weight="bold"'));
    if (bar.cue) lines.push(wordsXml(bar.cue, 'font-style="italic"'));

    const rhItems = parseHand(bar.rh, `${where}右手`);
    const rhMarks = collect(
      parseMarks(bar.tempo).map(([pos, bpm]) => [pos, `      <sound tempo="${bpm}"/>`]),
      parseMarks(bar.ottava).map(([pos, type]) => [pos, ottavaXml(type)]),
      bar.wedge ? [[0, wedgeXml(bar.wedge)]] : [],
      bar.dyn ? [[0, dynXml(bar.dyn)]] : [],
      parseMarks(bar.chords).map(([pos, name]) => [pos, harmonyXml(name)]),
    );
    lines.push(handXml(rhItems, { staff: 1, voice: 1, before: rhMarks, state: right, where: `${where}右手`, level: bar.level, key }));
    lines.push(`      <backup><duration>${BAR}</duration></backup>`);
    const lhMarks = collect(parseMarks(bar.pedal).map(([pos, type]) => [pos, pedalXml(type)]));
    lines.push(handXml(parseHand(bar.lh, `${where}左手`), { staff: 2, voice: 5, before: lhMarks, state: left, where: `${where}左手`, level: bar.level, key }));

    // 歌词位置：这一小节旋律里每个新起的音对一个字，标了 _ 的和连线延续过来的不算
    if (bar.sing) {
      if (bars[i - 1]?.sing !== bar.sing) {
        if (counters.has(bar.sing)) {
          const had = partLength.get(bar.sing);
          if (had !== undefined && had !== counters.get(bar.sing)) throw new Error(`歌词段落“${bar.sing}”两次出现的字数不一样`);
          partLength.set(bar.sing, counters.get(bar.sing));
        }
        counters.set(bar.sing, 0);
      }
      for (const it of rhItems) {
        if (!it.pitches.length || it.silent || it.tieStop) continue;
        const k = counters.get(bar.sing);
        counters.set(bar.sing, k + 1);
        slots.push({ bar: i + 1, pos: it.pos, part: bar.sing, k });
      }
    }

    if (bar.repeat === 'end') lines.push('      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>');
    else if (i === bars.length - 1) lines.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
    lines.push('    </measure>');
    return lines.join('\n');
  });
  if (right.open.size || left.open.size) throw new Error('曲子结束时还有没接上的连线');

  // 各段歌词按第一次出现的顺序排成一串，重复的段落用同样的序号
  const offsets = new Map();
  let total = 0;
  for (const [part, count] of counters) {
    const had = partLength.get(part);
    if (had !== undefined && had !== count) throw new Error(`歌词段落“${part}”两次出现的字数不一样`);
    offsets.set(part, total);
    total += count;
  }
  const slotText = slots.map((s) => `${s.bar}:${s.pos}=${offsets.get(s.part) + s.k}`).join(' ');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${title}</work-title></work>
  <identification>
    <creator type="composer">${composer}</creator>
    <encoding><software>${software}</software></encoding>${
      slotText
        ? `
    <miscellaneous>
      <miscellaneous-field name="schwingt-lyric-slots">${slotText}</miscellaneous-field>
    </miscellaneous>`
        : ''
    }
  </identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
${measures.join('\n')}
  </part>
</score-partwise>
`;

  const range = (list) => `${noteName(Math.min(...list))}–${noteName(Math.max(...list))}`;
  const parts = [...counters].map(([part, count]) => `${part} ${count}`).join('、');
  const summary =
    `${bars.length} 小节，右手 ${right.notes.length} 个音符（${range(right.notes)}），左手 ${left.notes.length} 个音符（${range(left.notes)}）` +
    (total ? `\n歌词位置 ${total} 个字（${parts}）` : '');
  return { xml, summary, slots: total };
}

/** 生成并写到文件，打印一行小结 */
export function writeScore(out, spec) {
  const { xml, summary } = buildScore(spec);
  writeFileSync(out, xml, 'utf8');
  console.log(`已生成 ${out}\n${summary}`);
}
