// 《反方向的钟》C 调小跨度版：在 C 调版（make-c-fanfangxiang.mjs）的基础上只改左手，让手不用张开。
// 用法：node scripts/make-c-compact-fanfangxiang.mjs
//
// 和 C 调版一样的地方：结构（67 小节）、右手的旋律和节奏、和声（导歌照原曲用升 sol、升 fa）、力度、踏板。
//
// 改了的地方：
// - 左手的音型整个搬到中音区，收在一个手位里：F 是 fa do la sol，G 是 sol re ti sol，都不超过五度；
//   Am7 是 la mi do sol，六度。C 调版是根音、五度、十度，一只手要够到十度
// - 换和弦时手只挪一个键（fa → sol → la），没有大跳
// - 进副歌前一拍一个的重音和弦，左手原来是八度，改成五度、三度的双音
// - 右手只动了第一遍副歌里垫在旋律下面的几个 mi：左手搬上来以后会和它抢同一个键，
//   句中的换成 sol，句尾的去掉。旋律一个音没动
// - 代价：低音没有 C 调版那么沉，副歌听起来会薄一点
//
// 小节的记法见 scripts/lib/score.mjs。
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain, up, writeScore } from './lib/score.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/scores/fanfangxiang-de-zhong-c-compact.musicxml');

// ---------- 右手的素材 ----------
/** 前奏的动机：la sol mi re，低八度再来一遍 la sol mi */
const RIFF = 'A5:2/5 G5:2/4 E5:2/2 D5:2~/1 D5:2 A4:2/5 G4:2/4 E4:2~/2';
/** 同一个动机，前四个音下面垫上四度、五度 */
const RIFF_FOURTHS = 'A5+E5:2 G5+D5:2 E5+A4:2 D5+G4:2~ D5+G4:2 A4:2 G4:2 E4:2~';
/** 动机的后半句，停在 sol 上，像一句问话 */
const ASK = 'E4:2 D4:2/1 E4:2/2 G4:2~/4 G4:8';
/** 动机的后半句，落到 la 上，像回答 */
const ANSWER = 'E4:2 D4:2 E4:2 G4:2 A4:8';
/** 主歌四个字一组的念唱：mi re mi mi，第三个字提前进来 */
const CELL = 'E5:2 D5:1 E5:1~ E5:2 E5:2';
/** 同一组，第一个音下面加三度 */
const CELL_THIRD = 'E5+C5:2 D5:1 E5:1~ E5:2 E5:2';
/** 导歌第一句：mi fa re｜re mi do｜re｜ti｜do ti → la */
const PRE = 'r:2 E5:1/4 F5:1/5 D5:2/3 D5:1 E5:1 C5:2/2 D5:2 B4:2/1 C5:1 B4:1';
/** 导歌第二句：同样的旋律，后半句加六度；最后一个音是拖腔，不对新的字 */
const PRE_SIXTHS = 'r:2 E5:1 F5:1 D5:2 D5:1 E5:1 C5+E4:2 D5+F4:2 B4+D4:2 C5:1 B4:1_';
/** 副歌：la sol mi re – mi do｜re mi sol。和声加在句首和长音上；垫在下面的音不低于 sol，给左手让出 mi */
const HOOK = 'A5+C5:2/5 G5:2/4 E5:2/3 D5+G4:2~/2 D5+G4:4 E5:2/3 C5+G4:2~/2';
const HOOK_TAIL = 'C5+G4:2 D5:4/3 E5:2~/4 E5:2 G5+C5:6/5';
/** 第二句：结尾的 re 落到 do */
const HOOK_2 = 'A5+C5:2 G5:2 E5:2 D5+G4:2~ D5+G4:4 E5:2 D5:2~';
const HOOK_2_TAIL = 'D5:4 C5:2 D5:2~ D5:2 C5+G4:6_';
/** 第四句：落在低八度的 la 上 */
const HOOK_4 = 'A5+C5:2 G5:2 E5:2 D5+G4:2~ D5+G4:4 E5:2 A4:2~';

// ---------- 左手的素材 ----------
/** 骨架：根音、五度，再落一个长音（F、Am7 落在 sol，G 落在 ti）。手不用张开 */
const SKELETON = { F: 'F3:2 C4:2 G3:4', G: 'G3:2 D4:2 B3:4', A: 'A3:2 E4:2 G3:4' };
/** 完整的音型：根音、五度、三度，落到 sol。F、G 在五度以内，Am7 是六度 */
const FULL = { F: 'F3:2 C4:2 A3:2 G3:2', G: 'G3:2 D4:2 B3:2 G3:2', A: 'A3:2 E4:2 C4:2 G3:2' };
const HALVES = 'change@0 change@8';
const fg = (set) => ({ lh: `${set.F} ${set.G}`, chords: 'F@0 G@8', pedal: HALVES });
const am = (set) => ({ lh: `${set.A} ${set.A}`, chords: 'Am7@0', pedal: HALVES });
/** 前奏、尾奏里 Am7 那一小节：la do sol，停住。不弹 mi，右手这时正在 mi 上 */
const AM_HOLD = { lh: 'A3:2 C4:2 G3:4~ G3:8', chords: 'Am7@0', pedal: 'change@0' };

// ---------- 各段 ----------
const intro = [
  { label: '前奏', dyn: 'pp', level: 0.5, rh: RIFF, lh: 'F3:2/5 C4:2/1 G3:4/4 G3:2/5 D4:2/1 B3:4/3', chords: 'F@0 G@8', pedal: 'start@0 change@8' },
  { level: 0.5, rh: ASK, lh: 'A3:2/4 C4:2/2 G3:4~/5 G3:8', chords: 'Am7@0', pedal: 'change@0' },
  { dyn: 'p', level: 0.62, rh: RIFF_FOURTHS, ...fg(SKELETON) },
  { level: 0.62, rh: ANSWER, ...AM_HOLD },
];

const verse = [
  // 前两句：单音旋律，左手只弹骨架
  { label: '主歌', dyn: 'mp', level: 0.8, rh: `E5:2/3 D5:1/2 E5:1~ E5:2 E5:2 ${CELL}`, ...fg(SKELETON) },
  { level: 0.8, rh: `${CELL} ${CELL}`, ...am(SKELETON) },
  { level: 0.8, rh: `${CELL} ${CELL}`, ...fg(SKELETON) },
  { level: 0.8, rh: `${CELL} ${CELL}`, ...am(SKELETON) },
  // 后两句：左手换成完整的音型；右手在 F 和 Am7 上每组第一个音加三度（do 是这两个和弦里的音）。
  // G 上不加：左手这时弹 ti，和右手的 do 挨得太近会发涩
  { level: 0.88, rh: `E5+C5:2/3 D5:1/2 E5:1~ E5:2 E5:2 ${CELL}`, lh: 'F3:2/5 C4:2/1 A3:2/3 G3:2/4 G3:2/5 D4:2/1 B3:2/3 G3:2/5', chords: 'F@0 G@8', pedal: HALVES },
  // 这一小节后半句多一个字，从 do 爬上来
  { level: 0.88, rh: 'E5+C5:2 D5:1 E5:1~ E5:2 E5:1 C5:1/1 D5:2 E5:2 E5:2 E5:2', lh: `A3:2/4 E4:2/1 C4:2/2 G3:2/5 ${FULL.A}`, chords: 'Am7@0', pedal: HALVES },
  { level: 0.88, rh: `${CELL_THIRD} ${CELL}`, ...fg(FULL) },
  { level: 0.88, rh: `${CELL_THIRD} ${CELL_THIRD}`, ...am(FULL) },
].map((bar) => ({ ...bar, sing: 'verse' }));

/**
 * 导歌连同进副歌前的铺垫。两遍一模一样，第二遍不再标指法。
 * 这一段照原曲的和声，是全曲唯一用到黑键的地方：低音半音下行（升 sol–sol｜升 fa–fa），
 * 旋律里有一个升 sol，进副歌前是带升 sol 的 E 大三和弦。换成白键和弦味道就不对了。
 */
function preChorus(first) {
  const f = (s) => (first ? s : plain(s));
  // 每个低音上面再弹一个和弦里的音，一拍一个
  const upper = { lh: 'G#2:4 E3:4 G2:4 D3:4', chords: 'E/G#@0 G@8', pedal: HALVES };
  const lower = { lh: 'F#2:4 D3:4 F2:4 C3:4', chords: 'D/F#@0 F@8', pedal: HALVES };
  return [
    { label: '导歌', dyn: 'mf', level: 0.94, sing: 'pre', rh: f(PRE), ...upper, lh: f('G#2:4/5 E3:4/1 G2:4/5 D3:4/1') },
    // 句尾的 la 之后接一个小小的回声：do sol la
    { level: 0.94, sing: 'pre', rh: f('A4:2/2 C5:2_ G4:2_ A4:2~_ A4:4 r:4'), ...lower, lh: f('F#2:4/5 D3:4/1 F2:4/5 C3:4/1') },
    { level: 0.98, sing: 'pre', rh: PRE_SIXTHS, ...upper },
    // 第三句：第三个字是升 sol，贴着 la 的下面擦过去；句尾的 ti 下面垫 mi，再由 do、la 接住（原曲这里是伴奏在接）
    { level: 1.0, sing: 'pre', rh: f('A4:2/3 B4:2/4 G#4:2/2 A4:2/3 B4+E4:4 C5+A4:4_'), ...lower },
    { level: 1.04, sing: 'pre', rh: 'A4:2 B4:2 A4:2 A4:2 B4+E4:4 C5+A4:4_', ...lower },
    // 从这里开始往上推：左手从一拍一个音变成半拍一个音
    {
      cue: '渐强',
      wedge: 'crescendo',
      level: [1.06, 1.16],
      sing: 'pre',
      rh: f('B4:2/3 C5:2/4 B4:4~ B4:2 C5:2_ D5:2_ B4:2_'),
      lh: f('D3:2/5 A3:2/1 F3:2/3 A3:2 D3:2 A3:2 F3:2 A3:2'),
      chords: 'Dm@0',
      pedal: HALVES,
    },
    // E 大三和弦：左手分解和弦里有升 sol；右手绕着 ti 和 mi 一级级爬到最高，每一拍都落在和弦里的音上
    {
      level: [1.16, 1.3],
      rh: f('B4:2/2 A4:2/1 B4:2 D5:2/4 E5:2/2 D5:2/1 E5:2 B5:2/5'),
      lh: f('E3:2/5 B3:2/1 G#3:2/2 B3:2 E3:2 B3:2 G#3:2 B3:2'),
      chords: 'E@0',
      pedal: HALVES,
    },
    // 一拍一个重音：E（低音升 sol）、E、F、E7，左手是三度、五度的双音，不弹八度；最高音 mi–ti–do–re–sol 送进副歌的 la；踏板一拍一换，最后抬起
    {
      cue: '重音',
      wedge: 'stop',
      dyn: 'ff',
      level: 1.39,
      rh: 'E5+B4+G#4:2 r:2 B4+G#4+E4:2 r:2 C5+A4+F4:2 r:2 D5+B4+G#4:2 G5:2',
      lh: 'B3+G#3:4 B3+E3:4 C4+F3:2 C4+F3:2 B3+E3:4',
      chords: 'E/G#@0 E@4 F@8 E7@12',
      pedal: 'change@0 change@4 change@8 change@12 stop@16',
    },
  ];
}

/** 副歌。最后一小节的后两拍是往高八度去的两个音，从那里起记成 8va */
function chorus(first) {
  const f = (s) => (first ? s : plain(s));
  return [
    { label: '副歌', dyn: 'f', rh: f(HOOK), ...fg(FULL), pedal: 'start@0 change@8' },
    { rh: f(HOOK_TAIL), ...am(FULL) },
    { rh: HOOK_2, ...fg(FULL) },
    { rh: HOOK_2_TAIL, ...am(FULL) },
    { rh: plain(HOOK), ...fg(FULL) },
    { rh: plain(HOOK_TAIL), ...am(FULL) },
    { rh: HOOK_4, ...fg(FULL) },
    { level: [1.2, 1.3], rh: 'A4:8~ A4:2 r:2 E6:2_ G6:2_', ...am(FULL), ottava: 'start@12' },
  ].map((bar) => ({ level: 1.2, ...bar, sing: 'ch1' }));
}

/** 副歌再来一遍，整段高八度（谱面上和前一遍一样，上面标 8va）。fade 是结尾的力度落到多少 */
function chorusHigh(fade) {
  return [
    { dyn: 'ff', rh: up(plain(HOOK)), ...fg(FULL) },
    { rh: up(plain(HOOK_TAIL)), ...am(FULL) },
    { rh: up(HOOK_2), ...fg(FULL) },
    { rh: up(HOOK_2_TAIL), ...am(FULL) },
    { rh: up(plain(HOOK)), ...fg(FULL) },
    { rh: up(plain(HOOK_TAIL)), ...am(FULL) },
    { rh: up(HOOK_4), ...fg(FULL) },
    { level: [1.3, fade], rh: 'A5+E5:8~ A5+E5:4 r:4', lh: `${FULL.A} A3:2 E4:2 C4:4`, chords: 'Am7@0', pedal: `${HALVES} stop@16`, ottava: 'stop@16' },
  ].map((bar) => ({ level: 1.32, ...bar, sing: 'ch2' }));
}

// 间奏：一下子静下来。左手在中音区一拍一个音，弹每个和弦的根音和三度
const interlude = [
  { label: '间奏', dyn: 'p', rh: 'C4:2/1 D4:2/2 E4:2/3 A4:2~/5 A4:2 G4:2 E4:2 D4:2', lh: 'F3:4/4 A3:4/2 G3:4/3 B3:4/1', chords: 'F@0 G@8', pedal: 'start@0 change@8' },
  // 这一小节后半左手落到 mi 上，不弹 ti，免得和右手的 do 撞在一起
  { rh: 'C4:2 D4:2 E4:2 G4:2~ G4:2 A4:2 C5:2 B4:2', lh: 'A3:4 C4:4 G3:4 E3:4', chords: 'Am@0 Em@8', pedal: HALVES },
  { rh: 'C5:2 A4:2 E4:2 D4:2~ D4:2 E4:4 A4:2~', lh: 'F3:4 A3:4 G3:4 B3:4', chords: 'F@0 G@8', pedal: HALVES },
  { rh: 'A4:8 r:8', lh: 'A2:4 E3:12', chords: 'Am@0', pedal: 'change@0' },
].map((bar) => ({ level: 0.62, ...bar }));

// 尾奏：前奏的动机轻轻地再来一遍，渐慢，停在 Am 加九度的和弦上（左手 la mi do，右手 ti mi）
const outro = [
  { label: '尾奏', dyn: 'p', level: 0.62, rh: plain(RIFF), ...fg(SKELETON), pedal: 'start@0 change@8' },
  { cue: '渐慢', level: [0.6, 0.48], tempo: '80@0 70@8', rh: ANSWER, ...AM_HOLD },
  { dyn: 'pp', level: 0.45, tempo: '58@0', rh: 'r:4 E5+B4:12^', lh: 'A3:2 E4:2 C4:4~ C4:8', chords: 'Am@0', pedal: 'change@0 stop@16' },
];

writeScore(OUT, {
  title: '反方向的钟（C 调小跨度版）',
  composer: '周杰伦',
  software: 'schwingt make-c-compact-fanfangxiang',
  tempo: 88,
  bars: [...intro, ...verse, ...preChorus(true), ...chorus(true), ...chorusHigh(1.0), ...interlude, ...preChorus(false), ...chorus(false), ...chorusHigh(0.9), ...outro],
});
