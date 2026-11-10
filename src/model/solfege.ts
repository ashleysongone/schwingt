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

/** 一个音在指定模式下显示成什么 */
export function labelFor(step: string, alter: number, fifths: number, mode: LabelMode): string {
  if (mode === 'letter') return step + accidental(alter);
  if (mode === 'fixed') return accidental(alter) + SYLLABLES[STEP_INDEX[step]];

  const tonic = majorTonic(fifths);
  const degree = (STEP_INDEX[step] - STEP_INDEX[tonic.step] + 7) % 7;
  const actual = (STEP_SEMITONE[step] + alter - STEP_SEMITONE[tonic.step] - tonic.alter + 24) % 12;
  const diff = ((actual - MAJOR[degree] + 18) % 12) - 6;
  const name = mode === 'number' ? String(degree + 1) : SYLLABLES[degree];
  return accidental(diff) + name;
}
