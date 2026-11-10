// 用本机的 Edge 无界面跑一遍主要功能，并截图。
// 用法：先 npm run dev，再 node scripts/e2e.mjs [网址] [截图目录]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'e2e-out';
mkdirSync(outDir, { recursive: true });

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__schwingt?.view?.isLoaded && window.__schwingt.timeline, null, {
  timeout: 60000,
});
const loadMs = Date.now() - t0;

/** 从曲库里打开一首自带的曲子 */
async function openFromLibrary(title) {
  await page.click('#btn-library');
  await page.waitForSelector('#library[open]');
  await page.evaluate((t) => {
    const items = Array.from(document.querySelectorAll('#library-list .library-open'));
    items.find((b) => b.querySelector('strong').textContent === t).click();
  }, title);
  await page.waitForFunction(
    (t) => document.getElementById('busy').hidden && window.__schwingt.score?.title === t && window.__schwingt.view.isLoaded,
    title,
    { timeout: 60000 },
  );
  await sleep(300);
}

// 下面的基本功能都在示例曲上测
await openFromLibrary('小星星');

// ---------- 打开后的状态 ----------
const info = await page.evaluate(() => {
  const s = window.__schwingt;
  const tl = s.timeline;
  let missing = 0;
  const missingSamples = [];
  for (const b of tl.steps) {
    const loc = tl.locate(b);
    if (!s.view.hasStep(loc.measure, loc.offset)) {
      missing++;
      if (missingSamples.length < 5) missingSamples.push([loc.measure, loc.offset]);
    }
  }
  return {
    title: s.score.title,
    measures: s.score.measures.length,
    notes: s.score.notes.length,
    tracks: s.score.tracks.map((t) => t.name),
    total: tl.total,
    steps: tl.steps.length,
    viewSteps: s.view.stepCount(),
    missing,
    missingSamples,
    orderMismatch: s.orderMismatch,
    svg: document.querySelectorAll('#score-host svg').length,
    lyricTexts: Array.from(document.querySelectorAll('#score-host svg text')).filter((t) =>
      /^(♯|♭)?(do|re|mi|fa|sol|la|si)$/.test(t.textContent.trim()),
    ).length,
    keys: document.querySelectorAll('#keyboard .key').length,
    hands: Array.from(document.querySelectorAll('#hands .hand-name')).map((e) => e.textContent),
    cursorHidden: document.querySelector('.cursor').hidden,
  };
});
console.log('打开耗时(ms):', loadMs);
console.log(JSON.stringify(info, null, 1));
check('谱面已渲染', info.svg >= 1);
check('两只手的控件', info.hands.length === info.tracks.length, info.hands.join(','));
check('时间线上每个音符位置都能在谱面上定位', info.missing === 0, `缺 ${info.missing} 个 ${JSON.stringify(info.missingSamples)}`);
check('反复展开与谱面库一致', info.orderMismatch === false);
check('唱名已标在谱面上', info.lyricTexts > 0, `${info.lyricTexts} 个`);

await sleep(400);
await page.screenshot({ path: join(outDir, '01-opened.png') });
const cursorBox = await page.evaluate(() => {
  const r = document.querySelector('.cursor').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, hidden: document.querySelector('.cursor').hidden };
});
check('光标显示在谱面上', !cursorBox.hidden && cursorBox.h > 40, JSON.stringify(cursorBox));

// ---------- 逐拍步进 ----------
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await sleep(150);
const stepped = await page.evaluate(() => {
  const s = window.__schwingt;
  return {
    beat: s.player.beat,
    expect: s.timeline.steps[3],
    on: Array.from(document.querySelectorAll('#keyboard .key.on')).map((k) => `${k.dataset.midi}:${k.textContent}`),
    sing: Array.from(document.querySelectorAll('.sing-hand .syl')).map((e) => e.textContent),
  };
});
check('→ 键前进三个音', Math.abs(stepped.beat - stepped.expect) < 1e-6, JSON.stringify(stepped));
check('键盘上亮起当前的键', stepped.on.length > 0, stepped.on.join(' '));
await page.screenshot({ path: join(outDir, '02-stepped.png') });
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('Home');

// ---------- 播放：预备拍、前进、暂停 ----------
await page.evaluate(() => window.__schwingt.player.seek(0));
await page.click('#btn-play');
await sleep(700);
const during = await page.evaluate(() => {
  const s = window.__schwingt;
  return { playing: s.player.playing, count: s.player.countInBeat, beat: s.player.beat, countShown: !document.getElementById('count').hidden };
});
check('预备拍期间显示数拍、光标停在开头', during.playing && during.count > 0 && during.beat === 0 && during.countShown, JSON.stringify(during));
await page.screenshot({ path: join(outDir, '03-count-in.png') });
// 70% 速度下每拍约 0.857 秒，四拍预备拍约 3.4 秒
await sleep(4300);
const after = await page.evaluate(() => {
  const s = window.__schwingt;
  return { playing: s.player.playing, count: s.player.countInBeat, beat: s.player.beat, ctx: s.piano.ctx.state, loaded: s.piano.loaded };
});
check('预备拍结束后开始往前走', after.playing && after.count === 0 && after.beat > 0.3, JSON.stringify(after));
await page.screenshot({ path: join(outDir, '04-playing.png') });
await page.keyboard.press('Space');
await sleep(100);
const paused = await page.evaluate(() => ({ playing: window.__schwingt.player.playing, beat: window.__schwingt.player.beat }));
check('空格暂停', !paused.playing && paused.beat > 0, JSON.stringify(paused));

// ---------- 只让电脑弹一只手 ----------
await page.click('#hands .hand.t0 .seg button:nth-child(2)');
const muted = await page.evaluate(() => Array.from(window.__schwingt.player.muted));
check('右手切到“我来弹”后静音', muted.length === 1 && muted[0] === 0, JSON.stringify(muted));
await page.click('#hands .hand.t0 .seg button:nth-child(1)');

// ---------- 选段循环 ----------
const boxes = await page.evaluate(() => {
  const host = document.querySelector('.sheet-osmd').getBoundingClientRect();
  return window.__schwingt.view.boxes.map((b) => b && { x: host.x + b.x + b.w / 2, y: host.y + b.top + b.height / 2 });
});
await page.click('#btn-select');
await page.mouse.click(boxes[1].x, boxes[1].y);
await sleep(100);
await page.screenshot({ path: join(outDir, '05-selecting.png') });
await page.mouse.click(boxes[2].x, boxes[2].y);
await sleep(200);
const region = await page.evaluate(() => {
  const s = window.__schwingt;
  return {
    region: s.region,
    loop: s.player.loop,
    total: s.timeline.total,
    chip: document.getElementById('region-text').textContent,
    boxes: document.querySelectorAll('.loop-box').length,
    beat: s.player.beat,
  };
});
check('选出第 2–3 小节并自动打开循环', region.region?.from === 1 && region.region?.to === 2 && region.loop && region.total === 8, JSON.stringify(region));
await page.screenshot({ path: join(outDir, '06-region.png') });

// 关掉预备拍，把速度拉到 120%，看循环能不能回到开头
await page.click('#btn-countin');
await page.evaluate(() => {
  const el = document.getElementById('tempo');
  el.value = '120';
  el.dispatchEvent(new Event('input'));
});
await page.click('#btn-play');
const seen = [];
for (let i = 0; i < 26; i++) {
  await sleep(250);
  seen.push(await page.evaluate(() => window.__schwingt.player.beat));
}
let wraps = 0;
for (let i = 1; i < seen.length; i++) if (seen[i] < seen[i - 1] - 1) wraps++;
check('循环段播完回到开头继续', wraps >= 1, `回头 ${wraps} 次，位置 ${seen.map((b) => b.toFixed(1)).join(' ')}`);
await page.keyboard.press('Space');
await page.click('#btn-region-clear');
const cleared = await page.evaluate(() => ({ region: window.__schwingt.region ?? null, total: window.__schwingt.timeline.total, loop: window.__schwingt.player.loop }));
check('取消选段后恢复全曲', cleared.region === null && cleared.total === info.total && !cleared.loop, JSON.stringify(cleared));
await page.click('#btn-countin');

// ---------- 唱名方式、单手唱名 ----------
await page.selectOption('#label-mode', 'number');
await page.waitForFunction(() => document.getElementById('busy').hidden);
await sleep(200);
const numbers = await page.evaluate(
  () => Array.from(document.querySelectorAll('#score-host svg text')).filter((t) => /^[1-7]$/.test(t.textContent.trim())).length,
);
check('切换到简谱数字', numbers > 20, `${numbers} 个`);
await page.click('#hands .hand.t1 .toggle');
await page.waitForFunction(() => document.getElementById('busy').hidden);
await sleep(200);
await page.screenshot({ path: join(outDir, '07-number-right-only.png') });
await page.click('#hands .hand.t1 .toggle');
await page.selectOption('#label-mode', 'fixed');
await page.waitForFunction(() => document.getElementById('busy').hidden);

// ---------- 曲库 ----------
await page.click('#btn-library');
await sleep(200);
await page.screenshot({ path: join(outDir, '08-library.png') });
const lib = await page.evaluate(() => document.querySelectorAll('#library-list .library-open').length);
check('曲库里列出曲子', lib >= 1, `${lib} 首`);
await page.click('#btn-library-close');

// ---------- 曲库里的三首曲子 ----------
for (const [title, slug] of [
  ['晴天', 'qingtian'],
  ['The Truth That You Leave', 'truth'],
  ['反方向的钟（C 调简化版）', 'fanfangxiang-easy'],
  ['反方向的钟（完整扒谱）', 'fanfangxiang'],
]) {
  await openFromLibrary(title);
  const song = await page.evaluate(() => {
    const s = window.__schwingt;
    const tl = s.timeline;
    let missing = 0;
    for (const b of tl.steps) {
      const loc = tl.locate(b);
      if (!s.view.hasStep(loc.measure, loc.offset)) missing++;
    }
    const keys = [];
    s.score.measures.forEach((m) => {
      if (keys[keys.length - 1]?.fifths !== m.fifths) keys.push({ at: m.number, fifths: m.fifths });
    });
    return {
      sheetTitle: Array.from(document.querySelectorAll('#score-host svg text')).some((t) => t.textContent.trim() === s.score.title),
      composer: s.score.composer,
      measures: s.score.measures.length,
      perHand: s.score.tracks.map((t) => s.score.notes.filter((n) => n.track === t.index).length),
      minutes: +(tl.secAt(tl.total) / 60).toFixed(2),
      keys,
      missing,
    };
  });
  check(`《${title}》能从曲库打开并定位`, song.missing === 0 && song.sheetTitle && song.perHand.every((n) => n > 0), JSON.stringify(song));
  await page.screenshot({ path: join(outDir, `11-${slug}.png`) });
  await page.click('#hands .hand.t0 .seg button:nth-child(2)');
  const startBeat = await page.evaluate(() => window.__schwingt.player.beat);
  await page.click('#btn-countin');
  await page.click('#btn-play');
  await sleep(1500);
  const moved = await page.evaluate(() => ({ beat: window.__schwingt.player.beat, playing: window.__schwingt.player.playing }));
  check(`《${title}》右手静音后能播放`, moved.playing && moved.beat > startBeat + 0.5, JSON.stringify(moved));
  await page.keyboard.press('Space');
  await page.click('#btn-countin');
}
await openFromLibrary('小星星');

// ---------- 平板尺寸 ----------
await page.setViewportSize({ width: 1024, height: 768 });
await sleep(900);
await page.screenshot({ path: join(outDir, '09-tablet.png') });
await page.setViewportSize({ width: 820, height: 1180 });
await sleep(900);
await page.screenshot({ path: join(outDir, '10-tablet-portrait.png') });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('竖屏平板没有横向溢出', overflow <= 0, `${overflow}px`);

check('浏览器控制台没有报错', logs.filter((l) => !/AudioContext/.test(l)).length === 0, logs.slice(0, 6).join(' | '));

console.log(results.join('\n'));
if (logs.length) console.log('控制台：\n' + logs.slice(0, 20).join('\n'));
await browser.close();
process.exit(failed ? 1 : 0);
