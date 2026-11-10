// 把一份谱子导入软件，核对解析结果和谱面定位是否对得上，并截一张图。
// 用法：先 npm run dev，再 node scripts/check-score.mjs <谱子文件> [截图路径] [截图前跳到第几小节] [网址]
import { chromium } from 'playwright-core';

const file = process.argv[2];
const shot = process.argv[3];
const gotoMeasure = Number(process.argv[4] ?? 0);
const url = process.argv[5] ?? 'http://127.0.0.1:5173/';
if (!file) {
  console.error('用法：node scripts/check-score.mjs <谱子文件> [截图路径] [截图前跳到第几小节] [网址]');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
// 每次用全新的浏览器环境，导入的谱子不会留在真实曲库里
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url);
await page.waitForFunction(() => window.__schwingt?.view?.isLoaded, null, { timeout: 60000 });
const before = await page.evaluate(() => window.__schwingt.score?.title);
const t0 = Date.now();
await page.setInputFiles('#file', file);
try {
  await page.waitForFunction(
    (prev) => {
      const s = window.__schwingt;
      const hint = document.getElementById('hint');
      const failed = !hint.hidden && hint.classList.contains('error');
      return failed || (document.getElementById('busy').hidden && s.score && s.score.title !== prev && s.view.isLoaded);
    },
    before,
    { timeout: 120000 },
  );
} catch {
  console.log('等待导入超时');
}
const ms = Date.now() - t0;

const info = await page.evaluate(() => {
  const s = window.__schwingt;
  const hint = document.getElementById('hint');
  if (!hint.hidden && hint.classList.contains('error')) return { error: hint.textContent };
  const tl = s.timeline;
  const score = s.score;
  let missing = 0;
  const samples = [];
  for (const b of tl.steps) {
    const loc = tl.locate(b);
    if (!s.view.hasStep(loc.measure, loc.offset)) {
      missing++;
      if (samples.length < 8) samples.push(`小节${score.measures[loc.measure].number}+${loc.offset}`);
    }
  }
  const perTrack = score.tracks.map((t) => {
    const notes = score.notes.filter((n) => n.track === t.index);
    const midis = notes.map((n) => n.midi);
    return { name: t.name, notes: notes.length, lowest: Math.min(...midis), highest: Math.max(...midis) };
  });
  const odd = score.measures.filter((m, i) => i > 0 && Math.abs(m.duration - m.nominal) > 1e-6).map((m) => `${m.number}:${m.duration}/${m.nominal}`);
  const keys = [];
  const times = [];
  score.measures.forEach((m) => {
    const k = `${m.fifths}${m.mode ? ' ' + m.mode : ''}`;
    if (keys[keys.length - 1]?.key !== k) keys.push({ at: m.number, key: k });
    const t = `${m.beats}/${m.beatType}`;
    if (times[times.length - 1]?.time !== t) times.push({ at: m.number, time: t });
  });
  return {
    title: score.title,
    composer: score.composer,
    measures: score.measures.length,
    playedMeasures: tl.segments.length,
    perTrack,
    graceNotes: score.notes.filter((n) => n.grace).length,
    fingerings: score.notes.filter((n) => n.fingering).length,
    pedalMarks: score.measures.reduce((a, m) => a + m.pedals.length, 0),
    tempos: score.measures.flatMap((m) => m.tempos.map((t) => `${m.number}:${Math.round(t.bpm)}`)).slice(0, 12),
    keys,
    times,
    pickup: score.measures[0].implicit ? `${score.measures[0].duration}/${score.measures[0].nominal}` : '无',
    repeats: score.measures.filter((m) => m.repeatStart || m.repeatEnd || m.endingStart || m.dacapo || m.dalsegno || m.coda || m.segno || m.fine || m.tocoda).length,
    irregularMeasures: odd.slice(0, 12),
    totalBeats: tl.total,
    minutesAtFullTempo: +(tl.secAt(tl.total) / 60).toFixed(2),
    steps: tl.steps.length,
    stepsNotOnSheet: missing,
    stepsNotOnSheetSamples: samples,
    playOrder: compress(tl.segments.map((x) => x.measure + 1)),
    // 谱面库自己展开的顺序，仅供对照；两者不同时要人工看一下哪个对
    sheetLibraryOrder: s.orderMismatch ? compress(s.view.measureOrder.map((x) => x + 1)) : '相同',
  };

  /** 把连续的小节合并成 a-b，方便看反复是怎么走的（小节从 1 数起） */
  function compress(arr) {
    const parts = [];
    let start = arr[0];
    let prev = arr[0];
    for (let i = 1; i <= arr.length; i++) {
      if (arr[i] === prev + 1) {
        prev = arr[i];
        continue;
      }
      parts.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = prev = arr[i];
    }
    return parts.join(' ');
  }
});
console.log(`导入耗时 ${ms} ms`);
console.log(JSON.stringify(info, null, 1));
if (logs.length) console.log('控制台：\n' + logs.slice(0, 15).join('\n'));
if (shot) {
  if (gotoMeasure > 0) {
    await page.evaluate((m) => {
      const s = window.__schwingt;
      s.player.seek(s.timeline.beatOfMeasure(m - 1) ?? 0);
    }, gotoMeasure);
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot });
}
await browser.close();
process.exit(info.error || info.stepsNotOnSheet ? 1 : 0);
