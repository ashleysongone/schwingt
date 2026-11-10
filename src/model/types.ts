/** 一个发声的音符。连音线连起来的几个音符已合并成一个。 */
export interface NoteEvent {
  id: number;
  /** 谱表序号：0 是第一行谱表（右手），1 是第二行（左手） */
  track: number;
  midi: number;
  step: string;
  alter: number;
  octave: number;
  /** 所在小节的序号（从 0 开始，按谱面书写顺序） */
  measure: number;
  /** 距小节开头的位置，单位是四分音符 */
  start: number;
  /** 发声时值，单位是四分音符 */
  dur: number;
  voice: string;
  grace: boolean;
  fingering?: string;
}

export type PedalType = 'start' | 'stop' | 'change';

export interface Measure {
  index: number;
  /** 谱面上印的小节号 */
  number: string;
  /** 实际长度，单位是四分音符 */
  duration: number;
  /** 按拍号算的长度 */
  nominal: number;
  beats: number;
  beatType: number;
  fifths: number;
  mode?: string;
  /** 弱起等不完整小节 */
  implicit: boolean;
  repeatStart: boolean;
  /** 0 表示没有反复记号，否则是这一段总共演奏的遍数 */
  repeatEnd: number;
  /** 从这一小节开始的跳房子编号 */
  endingStart?: number[];
  endingStop: boolean;
  segno?: boolean;
  coda?: boolean;
  dacapo?: boolean;
  dalsegno?: boolean;
  tocoda?: boolean;
  fine?: boolean;
  tempos: { offset: number; bpm: number }[];
  pedals: { offset: number; type: PedalType }[];
}

export interface Track {
  index: number;
  partId: string;
  staff: number;
  name: string;
}

export interface Score {
  title: string;
  composer: string;
  tracks: Track[];
  measures: Measure[];
  /** 按小节、位置排好序 */
  notes: NoteEvent[];
}

export const STEP_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
export const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function toMidi(step: string, alter: number, octave: number): number {
  return (octave + 1) * 12 + STEP_SEMITONE[step] + alter;
}
