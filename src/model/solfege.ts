import { STEP_INDEX, STEP_SEMITONE } from './types';

/**
 * fixed：固定调唱名，C 永远唱 do
 * movable：首调唱名，调的主音唱 do
 * number：简谱数字（首调）
 * letter：音名 C D E
 */
export type LabelMode = 'fixed' | 'movable' | 'number' | 'letter';

export const LABEL_MODES: { id: LabelMode; name: string }[] = [
  { id: 'fixed', name: '固定调 do re mi' },
  { id: 'movable', name: '首调 do re mi' },
  { id: 'number', name: '简谱 1 2 3' },
  { id: 'letter', name: '音名 C D E' },
];

const SYLLABLES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const FIFTHS_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

function accidental(alter: number): string {
  if (alter > 0) return '♯'.repeat(alter);
  if (alter < 0) return '♭'.repeat(-alter);
  return '';
}

/** 调号对应的大调主音，例如两个升号是 D，三个降号是 E♭ */
export function majorTonic(fifths: number): { step: string; alter: number } {
  const i = fifths + 1;
  return { step: FIFTHS_ORDER[((i % 7) + 7) % 7], alter: Math.floor(i / 7) };
}

/** 调号的中文名，例如“D 大调（2 个升号）” */
export function keyName(fifths: number, mode?: string): string {
  const t = majorTonic(fifths);
  let name = `${t.step}${accidental(t.alter)} 大调`;
  if (mode === 'minor') {
    const i = (STEP_INDEX[t.step] + 5) % 7;
    const pc = (STEP_SEMITONE[t.step] + t.alter + 9) % 12;
    const alter = ((pc - STEP_SEMITONE[STEPS[i]] + 18) % 12) - 6;
    name = `${STEPS[i]}${accidental(alter)} 小调`;
  }
  if (fifths === 0) return `${name}（没有升降号）`;
  return `${name}（${Math.abs(fifths)} 个${fifths > 0 ? '升' : '降'}号）`;
}

/** 简谱的高低音点：数字上面的点是高八度，下面的点是低八度，差几个八度就几个点 */
const DOT_ABOVE = '\u0307';
const DOT_BELOW = '\u0323';

/**
 * 一个音比“不带点的那一组”高（正）或低（负）几个八度。
 * 不带点的一组从主音起往上七个音：主音是 C 到 F 时取中央 C 那个八度的主音，G 到 B 时取中央 C 下面的那个
 * （不然 G 调以上的谱子大半都要带高音点）。按音名算，不按半音算，升降号不会把音挤到隔壁一组去。
 */
export function octaveOffset(step: string, octave: number, fifths: number): number {
  const tonic = STEP_INDEX[majorTonic(fifths).step];
  const base = (tonic <= STEP_INDEX.F ? 4 : 3) * 7 + tonic;
  return Math.floor((octave * 7 + STEP_INDEX[step] - base) / 7);
}

/** 把唱名拆成文字和高低音点的个数（正数是上面的点，负数是下面的点）。显示的时候点要自己画 */
export function splitDots(label: string): { text: string; dots: number } {
  const text = label.replace(/[\u0307\u0323]/g, '');
  const up = label.split(DOT_ABOVE).length - 1;
  const down = label.split(DOT_BELOW).length - 1;
  return { text, dots: up - down };
}

/** 一个音在指定模式下显示成什么。给了 octave 时，简谱数字会带上高低音点 */
export function labelFor(step: string, alter: number, fifths: number, mode: LabelMode, octave?: number): string {
  if (mode === 'letter') return step + accidental(alter);
  if (mode === 'fixed') return accidental(alter) + SYLLABLES[STEP_INDEX[step]];

  const tonic = majorTonic(fifths);
  const degree = (STEP_INDEX[step] - STEP_INDEX[tonic.step] + 7) % 7;
  const actual = (STEP_SEMITONE[step] + alter - STEP_SEMITONE[tonic.step] - tonic.alter + 24) % 12;
  const diff = ((actual - MAJOR[degree] + 18) % 12) - 6;
  if (mode !== 'number') return accidental(diff) + SYLLABLES[degree];
  const up = octave === undefined ? 0 : octaveOffset(step, octave, fifths);
  return accidental(diff) + String(degree + 1) + (up > 0 ? DOT_ABOVE : DOT_BELOW).repeat(Math.abs(up));
}
