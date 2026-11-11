// 《反方向的钟》C 调入门版：手工编配，直接写成 MusicXML（带和弦标记、踏板线、指法）。
// 比 C 调版（scripts/make-c-fanfangxiang.mjs）简单得多：右手单音，左手一拍一个音。
// 用法：node scripts/make-easy-fanfangxiang.mjs
//
// 编配思路：
// - 右手是人声旋律。音高和节奏照原曲（对照 public/scores/fanfangxiang-de-zhong.mid 的最高声部，移到 C 调），
//   扒谱里的加花、过门和高八度重复都不收。前奏的动机用 D E G A 四个音，副歌用 C D E G A 五个音，各一个手位
// - 左手是全曲通用的两小节固定音型：F–C、G–D | A–E–A，一拍一个音。
//   导歌换成半音下行的低音 G♯–G–F♯–F，两拍一个音，最后停在属和弦 E 上再进副歌
// - 踏板跟着和弦换。谱面上的踏板线：横线是踩着，尖角是换踏板，线断开是抬起
// - 跨过小节正中间的长音拆成两个音用连线连起来，这样每小节的第三拍在谱面上都看得见
//
// 小节的记法见 scripts/lib/score.mjs。
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain, writeScore } from './lib/score.mjs';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/scores/fanfangxiang-de-zhong-easy.musicxml');

/** 前奏的动机：la sol mi re，低八度再来一遍 la sol mi */
const RIFF = 'A5:2/5 G5:2/4 E5:2/2 D5:2~/1 D5:2 A4:2/5 G4:2/4 E4:2~/2';
/** 动机的后半句，停在 sol 上，像一句问话 */
const RIFF_ASK = 'E4:2 D4:2/1 E4:2/2 G4:2~/4 G4:8';
/** 动机的后半句，落到 la 上，像回答 */
const RIFF_ANSWER = 'E4:2 D4:2 E4:2 G4:2 A4:8/5';
/** 主歌四个字一组的念唱：mi re mi mi，第三个字提前半拍的一半进来 */
const CELL = 'E5:2 D5:1 E5:1~ E5:2 E5:2';
/** 左手固定音型 */
const OST_FG = 'F2:4 C3:4 G2:4 D3:4';
const OST_AM = 'A2:4 E3:4 A3:8';
/** 导歌的旋律：mi fa re｜re mi do｜re｜ti｜do ti → la */
const PRE = 'r:2 E5:1/4 F5:1/5 D5:2/3 D5:1 E5:1 C5:2/2 D5:2 B4:2/1 C5:1 B4:1';
/** 副歌第一句：la sol mi re – mi do */
const HOOK = 'A5:2/5 G5:2/4 E5:2/3 D5:2~/2 D5:4 E5:2 C5:2~/1';
/** 副歌第一句的后半：re mi sol */
const HOOK_TAIL = 'C5:2 D5:4 E5:2~ E5:2 G5:6/4';

const FG = { lh: OST_FG, chords: 'F@0 G@8', pedal: 'change@0 change@8' };
const AM = { lh: OST_AM, chords: 'Am@0', pedal: 'change@0' };
const LINE = { lh: 'F#2:8 F2:8', chords: 'Am/F#@0 F@8', pedal: 'change@0 change@8' };

const BARS = [
  // 前奏
  { label: '前奏', rh: RIFF, lh: 'F2:4/5 C3:4/1 G2:4/5 D3:4/1', chords: 'F@0 G@8', pedal: 'start@0 change@8' },
  { rh: RIFF_ASK, lh: 'A2:4/5 E3:4/2 A3:8/1', chords: 'Am@0', pedal: 'change@0' },
  { rh: plain(RIFF), ...FG },
  { rh: plain(RIFF_ANSWER), ...AM },
  // 主歌：一小节八个字，四个字一组
  { label: '主歌', rh: `E5:2/3 D5:1/2 E5:1~ E5:2 E5:2 ${CELL}`, ...FG },
  { rh: `${CELL} ${CELL}`, ...AM },
  { rh: `${CELL} ${CELL}`, ...FG },
  { rh: `${CELL} ${CELL}`, ...AM },
  { rh: `${CELL} ${CELL}`, ...FG },
  // 第三句的后半句多一个字，从 do 爬上来
  { rh: 'E5:2 D5:1 E5:1~ E5:2 E5:1 C5:1/1 D5:2 E5:2 E5:2 E5:2', ...AM },
  { rh: `${CELL} ${CELL}`, ...FG },
  { rh: `${CELL} ${CELL}`, ...AM },
  // 导歌：低音一路半音下行
  { label: '导歌', rh: PRE, lh: 'G#2:8/2 G2:8/3', chords: 'E/G#@0 G@8', pedal: 'change@0 change@8' },
  { rh: 'A4:8~/2 A4:4 r:4', lh: 'F#2:8/2 F2:8/3', chords: 'Am/F#@0 F@8', pedal: 'change@0 change@8' },
  { rh: plain(PRE), lh: 'G#2:8 G2:8', chords: 'E/G#@0 G@8', pedal: 'change@0 change@8' },
  // 第三句：句尾的 ti 落在 F 上是个不稳的增四度，原曲由伴奏接一个 do 把它解决掉，这里交给右手
  { rh: 'A4:2/2 B4:2/3 A4:2 A4:2 B4:4 C5:4/4', ...LINE },
  { rh: 'A4:2 B4:2 A4:2 A4:2 B4:4 C5:4', ...LINE },
  { rh: 'B4:2/3 C5:2/4 B4:4~ B4:8', lh: 'D3+A3:16', chords: 'Dm@0', pedal: 'change@0' },
  // 往副歌推：右手在 E 和弦上爬两级，停住，换一口气
  { rh: 'A4:2/1 B4:2/2 A4:2 B4:2 D5:2/4 E5:2/5 D5:2 E5:2', lh: 'E3+B3:16', chords: 'E@0', pedal: 'change@0' },
  { rh: 'E5:8~ E5:4 r:4', lh: 'E3+G#3+B3:16', pedal: 'change@0 stop@16' },
  // 副歌，反复一遍
  { label: '副歌', repeat: 'start', rh: HOOK, lh: OST_FG, chords: 'F@0 G@8', pedal: 'start@0 change@8' },
  { rh: HOOK_TAIL, ...AM },
  { rh: 'A5:2 G5:2 E5:2 D5:2~ D5:4 E5:2 D5:2~', ...FG },
  { rh: 'D5:4 C5:2 D5:2~ D5:2 C5:6', ...AM },
  { rh: plain(HOOK), ...FG },
  { rh: plain(HOOK_TAIL), ...AM },
  { rh: 'A5:2 G5:2 E5:2 D5:2~ D5:4 E5:2/3 A4:2~/1', ...FG },
  { repeat: 'end', rh: 'A4:8~ A4:4 r:4', lh: OST_AM, chords: 'Am@0', pedal: 'change@0 stop@16' },
  // 尾奏：前奏的动机再来一遍，停在 la 上
  { label: '尾奏', rh: plain(RIFF), lh: OST_FG, chords: 'F@0 G@8', pedal: 'start@0 change@8' },
  { rh: 'E4:2 D4:2 E4:2 G4:2 A4:8~', ...AM },
  { rh: 'A4:16^', lh: 'A2+E3:16', pedal: 'change@0 stop@16' },
];

writeScore(OUT, {
  title: '反方向的钟（C 调入门版）',
  composer: '周杰伦',
  software: 'schwingt make-easy-fanfangxiang',
  tempo: 88,
  bars: BARS,
});
