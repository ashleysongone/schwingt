// 《反方向的钟》专属编配：按弹的人的手和喜好重新编的一版，C 调，直接写成 MusicXML。
// 用法：node scripts/make-custom-fanfangxiang.mjs
//
// 编给谁：左手够得到八度但不想连着按很多，最怕左手换位置和大跳；右手能弹三个音的和弦，愿意为了好听多练；
// 最喜欢第一次进副歌前那种一层层推上去的感觉。
//
// 旋律和节奏照原曲（对照网上一份完整的扒谱，移到 C 调），其余都是新编的：
// - 钟摆：左手根音、五度一拍一个音地来回，像钟摆。曲子从一小节钟摆开始，前奏、主歌前半、间奏、尾奏都用它
// - 左手不跳：每个和弦一个手位，最宽八度（根音、五度、八度，分开弹，不用同时按住）；
//   F → G → Am 每次只挪一个键，导歌的低音半音下行也是一个键一个键地滑。全曲同时按下的八度只有进副歌前那四下
// - 右手的和弦都在六度以内（只有全曲最后一个和弦是七度）。副歌里长音先单独弹出来，和弦里另外两个音等到拍点上再补进去，手有时间挪过去
// - 推进：从主歌到副歌每四小节加一层。
//   主歌前半 单音旋律 + 钟摆 → 主歌后半 右手加和弦、左手变成半拍一个音 →
//   导歌 低音半音下行，一拍一个音 → 右手加六度、左手半拍一个音 → 右手三个音的和弦 →
//   Dm 上渐强 → E 上双手半拍一个和弦，最高音一拍拍往上爬 → 停顿的重音（mi、ti、do）→
//   十六分音符的 re mi 升fa 升sol 冲上去，落在副歌的 la 上
// - 副歌的 Am 小节后半低音走到 sol，再回到 fa，和弦连成一条下行的线
// - 尾奏把前奏的动机倒过来弹一遍（la sol mi re 变成 re mi sol la），钟摆越摆越慢，最后停住
//
// 结构：前奏 → 主歌 → 导歌 → 副歌 → 副歌（高八度）→ 间奏 → 导歌 → 副歌 → 副歌（高八度）→ 尾奏，
// 重复的段落一个音都不差。68 小节。
//
// 小节的记法见 scripts/lib/score.mjs。
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain, up, writeScore } from './lib/score.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/scores/fanfangxiang-de-zhong-custom.musicxml');

// ---------- 左手的素材 ----------
/** 钟摆：根音、五度，一拍一个音 */
const SWING = { F: 'F2:4 C3:4', G: 'G2:4 D3:4', A: 'A2:4 E3:4' };
/** 根音、五度、八度、五度，半拍一个音。手张开到八度放好，不用挪 */
const ROLL = { F: 'F2:2 C3:2 F3:2 C3:2', G: 'G2:2 D3:2 G3:2 D3:2', A: 'A2:2 E3:2 A3:2 E3:2' };
/** Am 的低音走到 sol：sol、mi、sol、mi，中间那个音不动 */
const ROLL_A_OVER_G = 'G2:2 E3:2 G3:2 E3:2';
const HALVES = 'change@0 change@8';

const swingFG = { lh: `${SWING.F} ${SWING.G}`, chords: 'F@0 G@8', pedal: HALVES };
const swingAm = { lh: `${SWING.A} ${SWING.A}`, chords: 'Am7@0', pedal: HALVES };
const rollFG = { lh: `${ROLL.F} ${ROLL.G}`, chords: 'F@0 G@8', pedal: HALVES };
const rollAm = { lh: `${ROLL.A} ${ROLL.A}`, chords: 'Am7@0', pedal: HALVES };
/** 副歌里的 Am：后半小节低音下到 sol，接回下一小节的 fa */
const rollAmDown = { lh: `${ROLL.A} ${ROLL_A_OVER_G}`, chords: 'Am7@0 Am7/G@8', pedal: HALVES };

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
/**
 * 同一组配上和弦：第一个字弹三个音，第三个字后面的空当补两个音（不对歌词）。
 * F 和 Am 上是 la do mi，G 上是 sol ti mi，全曲的主歌只有这两个手型
 */
const CELL_A = 'E5+C5+A4:2 D5:1 E5:1 C5+A4:2_ E5:2';
const CELL_G = 'E5+B4+G4:2 D5:1 E5:1 B4+G4:2_ E5:2';

// ---------- 各段 ----------
const intro = [
  // 钟先自己摆一小节
  { label: '前奏', cue: '像钟摆', dyn: 'pp', level: 0.45, rh: 'r:16', lh: `A2:4/5 E3:4/1 ${SWING.A}`, chords: 'Am7@0', pedal: 'start@0 change@8' },
  { level: 0.5, rh: RIFF, lh: 'F2:4/5 C3:4/1 G2:4/5 D3:4/1', chords: 'F@0 G@8', pedal: HALVES },
  { level: 0.5, rh: ASK, ...swingAm },
  { dyn: 'p', level: 0.62, rh: RIFF_FOURTHS, ...swingFG },
  { level: 0.62, rh: ANSWER, ...swingAm },
];

const verse = [
  // 前四小节：单音旋律，左手还是钟摆
  { label: '主歌', dyn: 'mp', level: 0.78, rh: `E5:2/3 D5:1/2 E5:1~ E5:2 E5:2 ${CELL}`, ...swingFG },
  { level: 0.78, rh: `${CELL} ${CELL}`, ...swingAm },
  { level: 0.8, rh: `${CELL} ${CELL}`, ...swingFG },
  { level: 0.82, rh: `${CELL} ${CELL}`, ...swingAm },
  // 后四小节加一层：右手配上和弦，左手变成半拍一个音，张开到八度
  { cue: '加一层', level: 0.88, rh: `E5+C5+A4:2/5 D5:1/4 E5:1/5 C5+A4:2_ E5:2 ${CELL_G}`, ...rollFG, lh: 'F2:2/5 C3:2/2 F3:2/1 C3:2/2 G2:2/5 D3:2/2 G3:2/1 D3:2/2' },
  // 这一小节后半句多一个字，从 do 爬上来
  { level: 0.9, rh: 'E5+C5+A4:2 D5:1 E5:1 C5+A4:2_ E5:1 C5:1/1 D5:2 E5:2 E5:2 E5:2', ...rollAm },
  { level: 0.92, rh: `${CELL_A} ${CELL_G}`, ...rollFG },
  { level: 0.94, rh: `${CELL_A} ${CELL_A}`, ...rollAm },
].map((bar) => ({ ...bar, sing: 'verse' }));

/**
 * 导歌，一路推到副歌。两遍一模一样，第二遍不再标指法。
 * 和声照原曲：低音半音下行（升 sol–sol｜升 fa–fa），再到 Dm、E，停在 E 上不解决，副歌从 F 进来。
 */
function preChorus(first) {
  const f = (s) => (first ? s : plain(s));
  // 低音上面再弹一个和弦里的音，一拍一个
  const stepUpper = { lh: f('G#2:4/5 E3:4/1 G2:4/5 D3:4/1'), chords: 'E/G#@0 G@8', pedal: HALVES };
  const stepLower = { lh: f('F#2:4/5 D3:4/1 F2:4/5 C3:4/1'), chords: 'D/F#@0 F@8', pedal: HALVES };
  // 同样的低音，变成半拍一个音：低音、中间的音、高八度的低音、中间的音
  const rollUpper = { lh: f('G#2:2/5 E3:2/2 G#3:2/1 E3:2/2 G2:2 D3:2 G3:2 D3:2'), chords: 'E/G#@0 G@8', pedal: HALVES };
  const rollLower = { lh: 'F#2:2 D3:2 F#3:2 D3:2 F2:2 C3:2 F3:2 C3:2', chords: 'D/F#@0 F@8', pedal: HALVES };
  return [
    // 第一句：单音旋律，mi fa re｜re mi do｜re｜ti｜do ti → la
    { label: '导歌', dyn: 'mf', level: 0.94, sing: 'pre', rh: f('r:2 E5:1/4 F5:1/5 D5:2/3 D5:1 E5:1 C5:2/2 D5:2 B4:2/1 C5:1 B4:1'), ...stepUpper },
    // 句尾的 la 之后接一个小小的回声：do sol la
    { level: 0.94, sing: 'pre', rh: f('A4:2/2 C5:2_ G4:2_ A4:2~_ A4:4 r:4'), ...stepLower },
    // 第二句加一层：后半句垫六度，左手变成半拍一个音。最后一个音是拖腔，不对新的字
    { cue: '加一层', level: 1.0, sing: 'pre', rh: 'r:2 E5:1 F5:1 D5:2 D5:1 E5:1 C5+E4:2 D5+F4:2 B4+D4:2 C5:1 B4:1_', ...rollUpper },
    // 第三句：第三个字是升 sol，贴着 la 的下面擦过去；句尾两个三个音的和弦，一个比一个高
    { level: 1.04, sing: 'pre', rh: f('A4:2/3 B4:2/4 G#4:2/2 A4:2/3 B4+G4+E4:4/5 C5+A4+F4:4_'), ...rollLower },
    { level: 1.08, sing: 'pre', rh: 'A4:2 B4:2 A4:2 A4:2 B4+G4+E4:4 C5+A4+F4:4_', ...rollLower },
    // Dm：唱完最后三个字，旋律自己往上走，开始渐强。ti 下面垫的 fa 到下一小节滑到 mi
    {
      cue: '渐强',
      wedge: 'crescendo',
      level: [1.1, 1.2],
      sing: 'pre',
      rh: f('B4+F4:2/5 C5:2 B4+F4:4~ B4+F4:2 C5:2_ D5:2_ B4:2_'),
      lh: f('D2:2/5 A2:2/2 D3:2/1 A2:2/2 D2:2 A2:2 D3:2 A2:2'),
      chords: 'Dm@0',
      pedal: HALVES,
    },
    // E：双手半拍一个和弦。右手每个和弦弹四下，然后最高音换到 re，下一小节再到 mi
    {
      level: [1.2, 1.34],
      rh: f('B4+G#4+E4:2/5 B4+G#4+E4:2 B4+G#4+E4:2 B4+G#4+E4:2 D5+B4+G#4:2/5 D5+B4+G#4:2 D5+B4+G#4:2 D5+B4+G#4:2'),
      lh: f('E2:2/5 B2:2/2 E3:2/1 B2:2/2 E2:2 B2:2 E3:2 B2:2'),
      chords: 'E@0 E7@8',
      pedal: HALVES,
    },
    // 停顿的重音：三下，每下之后都空出来；最后一拍是十六分音符的 re mi 升fa 升sol，冲进副歌的 la。
    // 左手是全曲仅有的四个八度，mi、mi、fa、mi，手几乎不用动；踏板一下一换，空的地方抬起来
    {
      cue: '重音',
      wedge: 'stop',
      dyn: 'ff',
      level: 1.4,
      rh: f('E5+B4+G#4:2 r:2 B4+G#4+E4:2 r:2 C5+A4+F4:2 r:2 D5:1/1 E5:1/2 F#5:1/3 G#5:1/4'),
      lh: 'E3+E2:2 r:2 E3+E2:2 r:2 F3+F2:2 r:2 E3+E2:4',
      chords: 'E@0 F@8 E7@12',
      pedal: 'change@0 change@4 change@8 change@12 stop@16',
    },
  ];
}

// 副歌：la sol mi re – mi do｜re mi sol。句首是三个音的和弦；
// 长音先单独弹出来，另外两个音在拍点上补进去（记成连线，旋律那个音按住不放）
const HOOK = 'A5+E5+C5:2/5 G5:2/4 E5:2/3 D5:2~/5 D5+B4+G4:4 E5:2 C5:2~';
const HOOK_TAIL = 'C5+A4+E4:2 D5:4 E5:2~ E5:2 G5+E5+C5:6';
/** 第二句：结尾的 re 落到 do。re 拖过小节线的时候，下面补上 mi、la */
const HOOK_2 = 'A5+E5+C5:2 G5:2 E5:2 D5:2~ D5+B4+G4:4 E5:2 D5:2~';
const HOOK_2_TAIL = 'D5+A4+E4:4 C5:2 D5:2~ D5:2 C5+A4+E4:6_';
/** 第四句：落在低八度的 la 上 */
const HOOK_4 = 'A5+E5+C5:2 G5:2 E5:2 D5:2~ D5+B4+G4:4 E5:2 A4:2~';
/** 副歌第一小节的左手：第一下是八度，砸在副歌的第一拍上，后面照常 */
const ARRIVE = `F3+F2:2 C3:2 F3:2 C3:2 ${ROLL.G}`;

/** 副歌。最后一小节的后两拍是往高八度去的两个音，从那里起记成 8va */
function chorus(first) {
  const f = (s) => (first ? s : plain(s));
  return [
    { label: '副歌', dyn: 'f', rh: f(HOOK), ...rollFG, lh: ARRIVE, pedal: 'start@0 change@8' },
    { rh: HOOK_TAIL, ...rollAmDown },
    { rh: HOOK_2, ...rollFG },
    { rh: HOOK_2_TAIL, ...rollAmDown },
    { rh: plain(HOOK), ...rollFG },
    { rh: HOOK_TAIL, ...rollAmDown },
    { rh: HOOK_4, ...rollFG },
    { level: [1.22, 1.3], rh: 'A4+E4+C4:8~ A4+E4+C4:2 r:2 E6:2_ G6:2_', ...rollAmDown, ottava: 'start@12' },
  ].map((bar) => ({ level: 1.22, ...bar, sing: 'ch1' }));
}

/** 副歌再来一遍，右手整段高八度（谱面上和前一遍一样，上面标 8va），左手不变。fade 是结尾的力度落到多少 */
function chorusHigh(fade) {
  return [
    { dyn: 'ff', rh: up(plain(HOOK)), ...rollFG, lh: ARRIVE },
    { rh: up(HOOK_TAIL), ...rollAmDown },
    { rh: up(HOOK_2), ...rollFG },
    { rh: up(HOOK_2_TAIL), ...rollAmDown },
    { rh: up(plain(HOOK)), ...rollFG },
    { rh: up(HOOK_TAIL), ...rollAmDown },
    { rh: up(HOOK_4), ...rollFG },
    { level: [1.32, fade], rh: 'A5+E5+C5:8~ A5+E5+C5:4 r:4', lh: `${ROLL.A} A2:2 E3:2 A3:4`, chords: 'Am7@0', pedal: `${HALVES} stop@16`, ottava: 'stop@16' },
  ].map((bar) => ({ level: 1.34, ...bar, sing: 'ch2' }));
}

// 间奏：一下子静下来，钟摆回来。旋律是原曲的间奏：do re mi la – sol mi re｜do re mi sol – la do ti｜do la mi re – mi – la
const interlude = [
  { label: '间奏', cue: '像钟摆', dyn: 'p', rh: 'C5:2/1 D5:2/2 E5:2/3 A5:2~/5 A5:2 G5:2 E5:2 D5:2', ...swingFG, pedal: 'start@0 change@8' },
  // 后半小节低音到 sol，上面还是 mi
  { rh: 'C5:2 D5:2 E5:2 G5:2~ G5:2 A5:2 C6:2 B5:2', lh: `${SWING.A} G2:4 E3:4`, chords: 'Am7@0 Em/G@8', pedal: HALVES },
  { rh: 'C6:2 A5:2 E5:2 D5:2~ D5:2 E5:4 A5:2~', ...swingFG },
  { rh: 'A5:8 r:8', ...swingAm },
].map((bar) => ({ level: 0.62, ...bar }));

// 尾奏：钟摆回来。前奏的动机正着弹一遍，再倒过来弹一遍（反方向），越来越慢，最后停在 la mi ti 上，钟摆也停住
const outro = [
  { label: '尾奏', cue: '像钟摆', dyn: 'p', level: 0.62, rh: 'A5:2/5 G5:2/4 E5:2/2 D5:2~/1 D5:8', ...swingFG, pedal: 'start@0 change@8' },
  { cue: '倒过来，渐慢', level: [0.6, 0.5], tempo: '82@0 74@8', rh: 'D5:2/1 E5:2/2 G5:2/4 A5:2~/5 A5:8', ...swingAm },
  { dyn: 'pp', level: 0.45, tempo: '62@0 52@8', rh: 'r:8 A5+E5+B4:8^', lh: 'A2:4 E3:4 A2:8^', chords: 'Am@0', pedal: 'change@0 stop@16' },
];

writeScore(OUT, {
  title: '反方向的钟（专属编配）',
  composer: '周杰伦',
  software: 'schwingt make-custom-fanfangxiang',
  tempo: 88,
  bars: [...intro, ...verse, ...preChorus(true), ...chorus(true), ...chorusHigh(1.0), ...interlude, ...preChorus(false), ...chorus(false), ...chorusHigh(0.9), ...outro],
});
