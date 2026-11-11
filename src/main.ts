import './style.css';
import { Piano } from './audio/piano';
import { Player } from './audio/player';
import { listScores, loadScoreFile, removeImported, saveImported, LibraryItem, ScoreFile } from './io/library';
import { interpret, OpenedScore } from './io/open';
import { withLabels } from './model/labels';
import { addLyrics, lyricLength, lyricSlots, lyricTokens } from './model/lyrics';
import { unroll } from './model/sequence';
import { keyName, labelFor, LABEL_MODES, LabelMode } from './model/solfege';
import { Timeline } from './model/timeline';
import { Score } from './model/types';
import { ActiveKey, Keyboard } from './view/keyboard';
import { ScoreView } from './view/scoreView';

// ---------- 设置 ----------

interface Settings {
  /** 速度，原速的百分比 */
  tempo: number;
  metronome: boolean;
  countIn: boolean;
  labelMode: LabelMode;
  /** 关掉唱名的谱表 */
  labelsOff: number[];
  zoom: number;
  lastScore?: string;
}

const SETTINGS_KEY = 'schwingt.settings.v1';
const DEFAULTS: Settings = {
  tempo: 70,
  metronome: false,
  countIn: true,
  labelMode: 'fixed',
  labelsOff: [],
  zoom: 1,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // 读不到就用默认值
  }
  return { ...DEFAULTS };
}

const settings = loadSettings();

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 无痕模式等情况下存不了，不影响使用
  }
}

// ---------- 歌词 ----------
// 歌词是使用者自己贴进来的，按曲子存在本机，不进谱子文件

const LYRICS_KEY = 'schwingt.lyrics.v1';

function loadLyrics(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LYRICS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    // 读不到就当没有
  }
  return {};
}

const lyricsById = loadLyrics();

function saveLyrics(): void {
  try {
    localStorage.setItem(LYRICS_KEY, JSON.stringify(lyricsById));
  } catch {
    // 存不了时这次照样显示，只是下次打开要重新贴
  }
}

// ---------- 界面元素 ----------

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

const scoreHost = $('score-host');
const emptyEl = $('empty');
const countEl = $('count');
const hintEl = $('hint');
const busyEl = $('busy');
const busyText = $('busy-text');
const singEl = $('sing');
const infoEl = $('info');
const handsEl = $('hands');
const titleEl = $('song-title');
const tempoInput = $<HTMLInputElement>('tempo');
const tempoLabel = $('tempo-label');
const iconPlay = $('icon-play');
const iconPause = $('icon-pause');
const btnMetro = $('btn-metro');
const btnCountIn = $('btn-countin');
const btnSelect = $('btn-select');
const btnLoop = $('btn-loop');
const regionChip = $('region-chip');
const regionText = $('region-text');
const labelModeSelect = $<HTMLSelectElement>('label-mode');
const libraryDialog = $<HTMLDialogElement>('library');
const libraryList = $('library-list');
const fileInput = $<HTMLInputElement>('file');
const btnLyrics = $('btn-lyrics');
const lyricsDialog = $<HTMLDialogElement>('lyrics');
const lyricsText = $<HTMLTextAreaElement>('lyrics-text');
const lyricsStatus = $('lyrics-status');

// ---------- 状态 ----------

const piano = new Piano();
const player = new Player(piano);
const view = new ScoreView(scoreHost);
const keyboard = new Keyboard($('keyboard'), (midi) => {
  void piano.resume().then(() => piano.play(midi, piano.ctx.currentTime, 0.7, 0.8));
});

let sourceDoc: Document | undefined;
let score: Score | undefined;
let timeline: Timeline | undefined;
let currentId: string | undefined;
/** 当前的五线谱是从 MIDI 自动转出来的 */
let generated = false;
/** 当前的谱子用得上多少个字的歌词；0 表示谱子里没标歌词位置 */
let lyricRoom = 0;
/** 选出来反复练的小节范围 */
let region: { from: number; to: number } | undefined;
/** 正在选段：还没点起点时 from 为空 */
let selecting: { from?: number } | undefined;
let orderMismatch = false;
let dirty = true;

interface HandUi {
  auto: HTMLButtonElement;
  me: HTMLButtonElement;
  label: HTMLButtonElement;
  sing: HTMLElement;
  syllable: HTMLElement;
}
const handUi = new Map<number, HandUi>();
const singStatus = h('span', 'sing-status');

// ---------- 提示 ----------

let hintTimer: number | undefined;

function hint(message: string, opts: { error?: boolean; sticky?: boolean; duration?: number } = {}): void {
  hintEl.textContent = message;
  hintEl.classList.toggle('error', !!opts.error);
  hintEl.hidden = false;
  window.clearTimeout(hintTimer);
  if (!opts.sticky) hintTimer = window.setTimeout(clearHint, opts.duration ?? (opts.error ? 7000 : 2600));
}

function clearHint(): void {
  window.clearTimeout(hintTimer);
  hintEl.hidden = true;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function withBusy<T>(text: string, fn: () => T | Promise<T>): Promise<T> {
  busyText.textContent = text;
  busyEl.hidden = false;
  // 等两帧，让“正在…”先画出来，再做会卡住界面的排版
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    return await fn();
  } finally {
    busyEl.hidden = true;
  }
}

// ---------- 打开谱子 ----------

function measureNumber(index: number): string {
  return score?.measures[index]?.number ?? String(index + 1);
}

function labelTracks(): Set<number> {
  const set = new Set<number>();
  for (const t of score?.tracks ?? []) if (!settings.labelsOff.includes(t.index)) set.add(t.index);
  return set;
}

async function renderScore(): Promise<void> {
  if (!sourceDoc || !score) return;
  const doc = withLabels(sourceDoc, { mode: settings.labelMode, tracks: labelTracks() });
  const words = currentId && lyricRoom ? lyricsById[currentId] : undefined;
  if (words) addLyrics(doc, lyricTokens(words));
  await view.load(doc, generated);
  const mine = unroll(score.measures);
  const theirs = view.measureOrder;
  orderMismatch = mine.length !== theirs.length || mine.some((v, i) => v !== theirs[i]);
  // 只作参考：谱面库自己的展开在个别谱子上会多走一遍跳房子，播放以我们算的为准
  if (orderMismatch) console.info('反复展开的结果和谱面库不一样', { mine, theirs });
  view.setLoop(region?.from, region?.to);
  dirty = true;
}

function rebuildTimeline(keepMeasure?: number): void {
  if (!score) return;
  timeline = new Timeline(score, region);
  const beat = keepMeasure === undefined ? 0 : (timeline.beatOfMeasure(keepMeasure) ?? 0);
  player.setTimeline(timeline, beat);
}

async function showScore(opened: OpenedScore, id: string, fallbackTitle = ''): Promise<void> {
  const parsed = opened.score;
  if (!parsed.notes.length) throw new Error('谱子里没有音符');
  if (!parsed.title) parsed.title = fallbackTitle || '未命名';

  player.setTimeline(undefined);
  sourceDoc = opened.doc;
  score = parsed;
  generated = opened.generated;
  currentId = id;
  lyricRoom = lyricLength(lyricSlots(opened.doc));
  updateLyricsButton();
  region = undefined;
  selecting = undefined;
  player.loop = false;
  player.muted.clear();
  settings.lastScore = id;
  saveSettings();

  titleEl.textContent = parsed.title;
  document.title = `${parsed.title} · Schwingt`;
  emptyEl.hidden = true;
  buildHands();
  rebuildTimeline();
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of parsed.notes) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  }
  keyboard.setRange(lo, hi);
  await renderScore();
  scoreHost.scrollTop = 0;
  updateToolbar();
  if (opened.generated) {
    hint(['这份五线谱是从 MIDI 自动转出来的，记谱和正式谱子会有出入', ...opened.warnings].join('；'), {
      duration: opened.warnings.length ? 9000 : 4500,
    });
  } else {
    // 上一首曲子留下的提示不该挂在这一首上
    clearHint();
  }
}

async function openScore(id: string, fallbackTitle = '', composer = ''): Promise<void> {
  try {
    await withBusy('正在打开谱子…', async () => {
      const file = await loadScoreFile(id);
      await showScore(interpret(file.data, file.name, { title: fallbackTitle, composer }), id, fallbackTitle);
    });
  } catch (err) {
    console.error(err);
    hint(`打不开这首曲子：${errorText(err)}`, { error: true });
    if (!score) emptyEl.hidden = false;
  }
}

async function importFile(file: File): Promise<void> {
  try {
    await withBusy('正在导入…', async () => {
      const scoreFile: ScoreFile = { name: file.name, data: await file.arrayBuffer() };
      const opened = interpret(scoreFile.data, scoreFile.name);
      const title = opened.score.title || file.name.replace(/\.[^.]+$/, '');
      let id = `temp:${Date.now()}`;
      try {
        id = await saveImported(title, opened.score.composer, scoreFile);
      } catch (err) {
        console.info('存不进本地曲库，这次只临时打开', err);
      }
      if (libraryDialog.open) libraryDialog.close();
      await showScore(opened, id, title);
    });
  } catch (err) {
    console.error(err);
    hint(`导入失败：${errorText(err)}`, { error: true });
  }
}

// ---------- 左右手 ----------

function buildHands(): void {
  handsEl.replaceChildren();
  singEl.replaceChildren();
  handUi.clear();
  if (!score) return;
  for (const t of score.tracks) {
    const cls = `t${Math.min(t.index, 2)}`;
    const wrap = h('div', `hand ${cls}`);
    const seg = h('div', 'seg');
    const auto = h('button', 'on', '电脑弹');
    const me = h('button', '', '我来弹');
    auto.title = '这只手由电脑弹出声音';
    me.title = '这只手不出声，我自己弹';
    auto.addEventListener('click', () => setMuted(t.index, false));
    me.addEventListener('click', () => setMuted(t.index, true));
    seg.append(auto, me);
    const label = h('button', 'toggle', '唱名');
    label.title = '在这只手的音符下面标出唱名';
    label.addEventListener('click', () => void toggleLabels(t.index));
    wrap.append(h('span', 'dot'), h('span', 'hand-name', t.name), seg, label);
    handsEl.append(wrap);

    const sing = h('div', `sing-hand ${cls}`);
    const syllable = h('span', 'syl');
    sing.append(h('span', 'who', t.name), syllable);
    singEl.append(sing);

    handUi.set(t.index, { auto, me, label, sing, syllable });
  }
  singEl.append(singStatus);
  updateHands();
}

function updateHands(): void {
  for (const [track, ui] of handUi) {
    const muted = player.muted.has(track);
    ui.auto.classList.toggle('on', !muted);
    ui.me.classList.toggle('on', muted);
    const labels = !settings.labelsOff.includes(track);
    ui.label.classList.toggle('on', labels);
    ui.sing.hidden = !labels;
  }
}

function setMuted(track: number, muted: boolean): void {
  if (muted) player.muted.add(track);
  else player.muted.delete(track);
  updateHands();
}

async function toggleLabels(track: number): Promise<void> {
  const i = settings.labelsOff.indexOf(track);
  if (i >= 0) settings.labelsOff.splice(i, 1);
  else settings.labelsOff.push(track);
  saveSettings();
  updateHands();
  await withBusy('正在重新排版…', renderScore);
}

// ---------- 歌词窗口 ----------

function updateLyricsButton(): void {
  btnLyrics.hidden = !lyricRoom;
  btnLyrics.classList.toggle('on', !!(currentId && lyricsById[currentId]));
}

function updateLyricsStatus(): void {
  const have = lyricTokens(lyricsText.value).length;
  lyricsStatus.textContent = !have ? '还没有歌词' : have < lyricRoom ? `现在有 ${have} 个字，后面 ${lyricRoom - have} 个音下面会空着` : `现在有 ${have} 个字，够用了`;
}

function showLyrics(): void {
  if (!currentId || !lyricRoom) return;
  lyricsText.value = lyricsById[currentId] ?? '';
  $('lyrics-need').textContent = String(lyricRoom);
  updateLyricsStatus();
  if (!lyricsDialog.open) lyricsDialog.showModal();
}

async function saveLyricsText(): Promise<void> {
  if (!currentId) return;
  const words = lyricsText.value.trim();
  if (words) lyricsById[currentId] = words;
  else delete lyricsById[currentId];
  saveLyrics();
  lyricsDialog.close();
  updateLyricsButton();
  await withBusy('正在重新排版…', renderScore);
}

// ---------- 工具栏 ----------

function updateToolbar(): void {
  btnMetro.classList.toggle('on', player.metronome);
  btnCountIn.classList.toggle('on', player.countIn);
  btnLoop.classList.toggle('on', player.loop);
  btnSelect.classList.toggle('on', !!selecting);
  regionChip.hidden = !region;
  if (region) {
    regionText.textContent =
      region.from === region.to
        ? `第 ${measureNumber(region.from)} 小节`
        : `第 ${measureNumber(region.from)}–${measureNumber(region.to)} 小节`;
  }
  dirty = true;
}

function setTempo(percent: number): void {
  const p = Math.min(120, Math.max(30, Math.round(percent / 5) * 5));
  settings.tempo = p;
  tempoInput.value = String(p);
  player.tempoFactor = p / 100;
  saveSettings();
  dirty = true;
}

function setRegion(r: { from: number; to: number } | undefined): void {
  if (!score) return;
  const keep = r ? r.from : timeline?.locate(player.beat).measure;
  region = r;
  player.loop = !!r;
  rebuildTimeline(keep);
  view.setLoop(r?.from, r?.to);
  updateToolbar();
}

function toggleSelecting(): void {
  if (!score) return;
  if (selecting) {
    selecting = undefined;
    view.setLoop(region?.from, region?.to);
    clearHint();
  } else {
    player.pause();
    selecting = {};
    hint('在谱子上点一下要练的第一个小节', { sticky: true });
  }
  updateToolbar();
}

function step(dir: 1 | -1): void {
  if (!timeline) return;
  if (player.playing) player.pause();
  const cur = player.beat;
  const target = dir > 0 ? timeline.nextStep(cur) : timeline.prevStep(cur);
  if (target === undefined) return;
  player.seek(target);
  void player.audition(target);
}

function setZoom(z: number): void {
  const zoom = Math.min(1.8, Math.max(0.5, Math.round(z * 10) / 10));
  if (zoom === settings.zoom) return;
  settings.zoom = zoom;
  saveSettings();
  view.zoom = zoom;
  void withBusy('正在重新排版…', () => {
    view.render();
    view.setLoop(region?.from, region?.to);
    dirty = true;
  });
}

view.onTap = (measure, offset) => {
  if (!score || !timeline) return;
  if (selecting) {
    if (selecting.from === undefined) {
      selecting.from = measure;
      view.setLoop(measure, measure, true);
      hint('再点一下最后一个小节（只练一小节就再点它一次）', { sticky: true });
    } else {
      const from = Math.min(selecting.from, measure);
      const to = Math.max(selecting.from, measure);
      selecting = undefined;
      clearHint();
      setRegion({ from, to });
    }
    return;
  }
  const start = timeline.beatOfMeasure(measure);
  if (start === undefined) {
    hint('这一小节不在选中的段落里');
    return;
  }
  const beat = start + Math.min(offset, score.measures[measure].duration);
  player.seek(beat);
  if (!player.playing) void player.audition(beat);
};

// ---------- 曲库 ----------

async function refreshLibrary(): Promise<LibraryItem[]> {
  const items = await listScores();
  libraryList.replaceChildren();
  for (const item of items) {
    const li = h('li');
    const open = h('button', 'library-open');
    open.classList.toggle('current', item.id === currentId);
    open.append(h('strong', '', item.title), h('small', '', [item.composer, item.note].filter(Boolean).join(' · ')));
    open.addEventListener('click', () => {
      libraryDialog.close();
      void openScore(item.id, item.title, item.composer);
    });
    li.append(open);
    if (!item.builtin) {
      const remove = h('button', 'library-remove', '删除');
      remove.addEventListener('click', async () => {
        if (!window.confirm(`从曲库里删除《${item.title}》？`)) return;
        await removeImported(item.id);
        await refreshLibrary();
      });
      li.append(remove);
    }
    libraryList.append(li);
  }
  if (!items.length) libraryList.append(h('li', 'library-empty', '曲库还是空的，先导入一份谱子'));
  return items;
}

async function showLibrary(): Promise<void> {
  await refreshLibrary();
  if (!libraryDialog.open) libraryDialog.showModal();
}

// ---------- 每一帧刷新 ----------

let lastBeat = -1;
let lastPlaying = false;
let lastCount = -1;
let lastTempoText = '';
let lastInfo = '';

function frame(): void {
  requestAnimationFrame(frame);
  if (!score || !timeline || !view.isLoaded) return;
  const beat = player.beat;
  const playing = player.playing;
  const count = player.countInBeat;
  if (!dirty && beat === lastBeat && playing === lastPlaying && count === lastCount) return;
  dirty = false;
  lastBeat = beat;
  lastCount = count;

  const loc = timeline.locate(beat);
  const m = score.measures[loc.measure];
  view.place(loc.measure, loc.offset, m.duration, playing && count === 0);

  const keys: ActiveKey[] = [];
  const sung = new Map<number, { midi: number; label: string }[]>();
  for (const tn of timeline.activeAt(beat)) {
    const n = tn.note;
    const label = labelFor(n.step, n.alter, score.measures[n.measure].fifths, settings.labelMode);
    let list = sung.get(n.track);
    if (!list) sung.set(n.track, (list = []));
    list.push({ midi: n.midi, label });
    // 播放时让键在音符结束前一点松开，同一个键连弹两次才看得出来
    if (playing && tn.end - beat <= Math.min(0.08, (tn.end - tn.start) * 0.2)) continue;
    keys.push({ midi: n.midi, track: n.track, label });
  }
  keyboard.setActive(keys);
  for (const [track, ui] of handUi) {
    const list = sung.get(track) ?? [];
    list.sort((a, b) => a.midi - b.midi);
    const text = list.length ? list.map((x) => x.label).join(' ') : '·';
    if (ui.syllable.textContent !== text) ui.syllable.textContent = text;
  }

  countEl.hidden = count === 0;
  if (count) countEl.textContent = String(count);

  if (playing !== lastPlaying) {
    lastPlaying = playing;
    iconPlay.toggleAttribute('hidden', playing);
    iconPause.toggleAttribute('hidden', !playing);
  }

  const bpm = Math.round((timeline.bpmAt(beat) * settings.tempo) / 100);
  const tempoText = `${settings.tempo}% · 每分钟 ${bpm} 拍`;
  if (tempoText !== lastTempoText) tempoLabel.textContent = lastTempoText = tempoText;

  const where = m.implicit && loc.measure === 0 ? '弱起小节' : `第 ${m.number} 小节`;
  const info = `${where} / 共 ${score.measures.length} 小节 · ${keyName(m.fifths, m.mode)} · ${m.beats}/${m.beatType} 拍`;
  if (info !== lastInfo) infoEl.textContent = lastInfo = info;
}

// ---------- 事件 ----------

let wakeLock: WakeLockSentinel | undefined;

async function syncWakeLock(): Promise<void> {
  // 播放时不让平板自动熄屏；不支持的环境直接跳过
  try {
    if (player.playing && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = undefined));
    } else if (!player.playing && wakeLock) {
      await wakeLock.release();
      wakeLock = undefined;
    }
  } catch {
    wakeLock = undefined;
  }
}

player.onChange = () => {
  dirty = true;
  void syncWakeLock();
};

function wire(): void {
  $('btn-library').addEventListener('click', () => void showLibrary());
  $('btn-empty-open').addEventListener('click', () => void showLibrary());
  $('btn-library-close').addEventListener('click', () => libraryDialog.close());
  $('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void importFile(file);
  });

  $('btn-play').addEventListener('click', () => {
    if (selecting) toggleSelecting();
    player.toggle();
  });
  $('btn-start').addEventListener('click', () => player.seek(0));
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));

  tempoInput.addEventListener('input', () => setTempo(Number(tempoInput.value)));
  $('btn-slower').addEventListener('click', () => setTempo(settings.tempo - 5));
  $('btn-faster').addEventListener('click', () => setTempo(settings.tempo + 5));

  btnMetro.addEventListener('click', () => {
    player.metronome = settings.metronome = !player.metronome;
    saveSettings();
    updateToolbar();
  });
  btnCountIn.addEventListener('click', () => {
    player.countIn = settings.countIn = !player.countIn;
    saveSettings();
    updateToolbar();
  });
  btnSelect.addEventListener('click', toggleSelecting);
  $('btn-region-clear').addEventListener('click', () => setRegion(undefined));
  btnLoop.addEventListener('click', () => {
    player.loop = !player.loop;
    updateToolbar();
  });

  for (const mode of LABEL_MODES) {
    const opt = h('option', '', mode.name);
    opt.value = mode.id;
    labelModeSelect.append(opt);
  }
  labelModeSelect.value = settings.labelMode;
  labelModeSelect.addEventListener('change', () => {
    settings.labelMode = labelModeSelect.value as LabelMode;
    saveSettings();
    labelModeSelect.blur();
    void withBusy('正在重新排版…', renderScore);
  });

  btnLyrics.addEventListener('click', showLyrics);
  $('btn-lyrics-close').addEventListener('click', () => lyricsDialog.close());
  $('btn-lyrics-save').addEventListener('click', () => void saveLyricsText());
  $('btn-lyrics-clear').addEventListener('click', () => {
    lyricsText.value = '';
    updateLyricsStatus();
    lyricsText.focus();
  });
  lyricsText.addEventListener('input', updateLyricsStatus);

  $('btn-zoom-out').addEventListener('click', () => setZoom(settings.zoom - 0.1));
  $('btn-zoom-in').addEventListener('click', () => setZoom(settings.zoom + 0.1));

  // 点过的按钮不保留焦点，这样空格键始终是播放 / 暂停
  document.addEventListener('click', (e) => {
    (e.target as HTMLElement).closest('button')?.blur();
  });

  document.addEventListener('keydown', (e) => {
    if (libraryDialog.open || lyricsDialog.open || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'SELECT' || tag === 'INPUT') {
      if (e.code !== 'Space') return;
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (selecting) toggleSelecting();
        player.toggle();
        break;
      case 'ArrowRight':
        e.preventDefault();
        step(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        step(-1);
        break;
      case 'Home':
        e.preventDefault();
        player.seek(0);
        break;
      case 'KeyM':
        btnMetro.click();
        break;
      case 'KeyL':
        btnLoop.click();
        break;
      case 'Escape':
        if (selecting) toggleSelecting();
        break;
    }
  });

  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (view.renderIfResized()) {
        view.setLoop(region?.from, region?.to);
        dirty = true;
      }
    }, 250);
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const file = e.dataTransfer?.files[0];
    if (file) void importFile(file);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncWakeLock();
  });
}

async function init(): Promise<void> {
  player.metronome = settings.metronome;
  player.countIn = settings.countIn;
  view.zoom = settings.zoom;
  wire();
  setTempo(settings.tempo);
  updateToolbar();

  singStatus.textContent = '钢琴音色加载中…';
  void piano
    .load(`${import.meta.env.BASE_URL}samples/piano/`, (done, total) => {
      singStatus.textContent = done < total ? `钢琴音色加载中 ${done}/${total}` : '';
    })
    .then(() => {
      singStatus.textContent = piano.loaded ? '' : '钢琴音色没加载成功，暂时用合成音';
    });

  const items = await refreshLibrary();
  const start = items.find((i) => i.id === settings.lastScore) ?? items[0];
  if (start) await openScore(start.id, start.title, start.composer);
  else emptyEl.hidden = false;
  requestAnimationFrame(frame);
}

// 调试和自动化测试用
Object.assign(window, {
  __schwingt: {
    player,
    piano,
    view,
    settings,
    get score() {
      return score;
    },
    get timeline() {
      return timeline;
    },
    get region() {
      return region;
    },
    get orderMismatch() {
      return orderMismatch;
    },
  },
});

void init();
