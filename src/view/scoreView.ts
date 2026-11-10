import { MusicSystem, OpenSheetMusicDisplay, VoiceEntry } from 'opensheetmusicdisplay';

interface StepPos {
  /** 距小节开头的位置，单位是四分音符 */
  offset: number;
  x: number;
  top: number;
  height: number;
}

interface MeasureBox {
  x: number;
  w: number;
  top: number;
  height: number;
}

/** 光标和循环段的色带比五线谱上下各多出这么多像素 */
const PAD = 14;

function systemExtent(sys: MusicSystem): { top: number; height: number } {
  const lines = sys.StaffLines;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const base = sys.PositionAndShape.AbsolutePosition.y;
  const top = base + first.PositionAndShape.RelativePosition.y;
  const bottom = base + last.PositionAndShape.RelativePosition.y + last.StaffHeight;
  return { top, height: bottom - top };
}

/**
 * 五线谱显示。谱面由 OpenSheetMusicDisplay 渲染，
 * 光标、循环段色带是叠在上面的一层，位置从谱面的排版数据算出来。
 */
export class ScoreView {
  readonly osmd: OpenSheetMusicDisplay;
  zoom = 1;
  /** 点了谱面上的某个位置 */
  onTap?: (measure: number, offset: number) => void;
  /** 谱面库自己展开反复得到的小节顺序，用来和时间线对照 */
  measureOrder: number[] = [];

  private readonly sheet: HTMLElement;
  private readonly osmdEl: HTMLElement;
  private readonly loopLayer: HTMLElement;
  private readonly cursorEl: HTMLElement;
  private steps: (StepPos[] | undefined)[] = [];
  private boxes: (MeasureBox | undefined)[] = [];
  private loaded = false;
  private lastTop = -1;
  private renderedWidth = 0;

  constructor(private readonly host: HTMLElement) {
    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet';
    this.osmdEl = document.createElement('div');
    this.osmdEl.className = 'sheet-osmd';
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    this.loopLayer = document.createElement('div');
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'cursor';
    this.cursorEl.hidden = true;
    overlay.append(this.loopLayer, this.cursorEl);
    this.sheet.append(this.osmdEl, overlay);
    host.append(this.sheet);

    this.osmd = new OpenSheetMusicDisplay(this.osmdEl, {
      backend: 'svg',
      autoResize: false,
      followCursor: false,
      pageFormat: 'Endless',
      drawTitle: true,
      drawSubtitle: false,
      drawComposer: true,
      drawLyricist: false,
      drawPartNames: false,
      drawPartAbbreviations: false,
      drawMeasureNumbers: true,
      measureNumberInterval: 1,
      drawFingerings: true,
      drawLyrics: true,
    });
    this.osmd.setLogLevel('warn');

    this.sheet.addEventListener('click', (e) => this.handleTap(e));
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** @param autoBeam 谱子里没有符杠信息时（MIDI 转出来的谱子）让谱面库自己连符杠 */
  async load(doc: Document, autoBeam = false): Promise<void> {
    this.osmd.setOptions({ autoBeam });
    await this.osmd.load(doc);
    this.loaded = true;
    this.render();
  }

  /** 重新排版，缩放或窗口宽度变了之后调用 */
  render(): void {
    if (!this.loaded) return;
    this.osmd.zoom = this.zoom;
    this.osmd.render();
    this.renderedWidth = this.host.clientWidth;
    this.measure();
    this.lastTop = -1;
  }

  /** 窗口宽度变了才需要重排 */
  renderIfResized(): boolean {
    if (!this.loaded || this.host.clientWidth === this.renderedWidth) return false;
    this.render();
    return true;
  }

  private stepPosition(entries: VoiceEntry[], k: number): Omit<StepPos, 'offset'> | undefined {
    const graphic = this.osmd.GraphicSheet;
    for (const ve of entries) {
      const sse = ve.ParentSourceStaffEntry;
      const measureIndex = sse.VerticalContainerParent.ParentMeasure.measureListIndex;
      const gse = graphic.findGraphicalStaffEntryFromMeasureList(
        sse.ParentStaff.idInMusicSheet,
        measureIndex,
        sse,
      );
      const sys = gse?.parentMeasure?.ParentMusicSystem;
      if (!gse || !sys) continue;
      const ext = systemExtent(sys);
      return { x: gse.PositionAndShape.AbsolutePosition.x * k, top: ext.top * k, height: ext.height * k };
    }
    return undefined;
  }

  /** 从排版数据里取出每个音符位置和每个小节的像素坐标 */
  private measure(): void {
    const k = 10 * this.osmd.zoom;
    this.steps = [];
    this.boxes = [];
    this.measureOrder = [];

    const cursor = this.osmd.cursor;
    cursor?.resetIterator();
    const it = cursor?.iterator;
    let lastMeasure = -1;
    let lastOffset = -1;
    let guard = 0;
    while (it && !it.EndReached && guard++ < 500000) {
      const mi = it.CurrentMeasureIndex;
      const offset = it.CurrentRelativeInMeasureTimestamp.RealValue * 4;
      if (mi !== lastMeasure || offset <= lastOffset) this.measureOrder.push(mi);
      lastMeasure = mi;
      lastOffset = offset;
      const list = (this.steps[mi] ??= []);
      if (!list.some((s) => Math.abs(s.offset - offset) < 1e-6)) {
        const pos = this.stepPosition(it.CurrentVoiceEntries ?? [], k);
        if (pos) list.push({ offset, ...pos });
      }
      it.moveToNext();
    }
    for (const list of this.steps) list?.sort((a, b) => a.offset - b.offset);

    this.osmd.GraphicSheet.MeasureList.forEach((staffMeasures, mi) => {
      for (const gm of staffMeasures ?? []) {
        const sys = gm?.ParentMusicSystem;
        if (!gm || !sys) continue;
        const ext = systemExtent(sys);
        const ps = gm.PositionAndShape;
        this.boxes[mi] = {
          x: ps.AbsolutePosition.x * k,
          w: ps.Size.width * k,
          top: ext.top * k,
          height: ext.height * k,
        };
        break;
      }
    });
  }

  /** 这个小节里有记录的音符位置数，调试和测试用 */
  stepCount(): number {
    return this.steps.reduce((a, l) => a + (l?.length ?? 0), 0);
  }

  hasStep(measure: number, offset: number): boolean {
    return !!this.steps[measure]?.some((s) => Math.abs(s.offset - offset) < 1e-4);
  }

  /**
   * 把光标放到某小节的某个位置。
   * @param smooth 为真时在两个音符之间平滑移动（播放中），否则停在音符上
   */
  place(measure: number, offset: number, measureDur: number, smooth: boolean): void {
    const list = this.steps[measure];
    if (!list?.length) {
      this.cursorEl.hidden = true;
      return;
    }
    let i = 0;
    while (i + 1 < list.length && list[i + 1].offset <= offset + 1e-6) i++;
    const s = list[i];
    let x = s.x;
    if (smooth) {
      const next = list[i + 1];
      const box = this.boxes[measure];
      const nextOffset = next ? next.offset : measureDur;
      const nextX = next ? next.x : box ? box.x + box.w : s.x;
      const span = nextOffset - s.offset;
      if (span > 1e-6 && nextX > s.x) {
        const t = Math.min(Math.max((offset - s.offset) / span, 0), 1);
        x = s.x + t * (nextX - s.x);
      }
    }
    const w = Math.max(10, 16 * this.zoom);
    this.cursorEl.hidden = false;
    this.cursorEl.style.width = `${w}px`;
    this.cursorEl.style.height = `${s.height + PAD * 2}px`;
    this.cursorEl.style.transform = `translate(${x - w / 2}px, ${s.top - PAD}px)`;

    if (s.top !== this.lastTop) {
      const first = this.lastTop === -1;
      this.lastTop = s.top;
      this.scrollToSystem(s.top, s.height, first);
    }
  }

  private scrollToSystem(top: number, height: number, first: boolean): void {
    const host = this.host;
    const offsetTop = this.sheet.offsetTop;
    const y = offsetTop + top;
    const margin = Math.min(110, host.clientHeight * 0.16);
    const visibleTop = host.scrollTop;
    const visibleBottom = visibleTop + host.clientHeight;
    // 刚打开或刚重排时，这一行只要完整看得见就不滚动，免得把曲名滚出去
    if (first && y - PAD >= visibleTop && y + height + PAD <= visibleBottom) return;
    // 已经舒服地在视野里就不动，避免逐拍步进时画面来回跳
    const comfortable = y - PAD >= visibleTop && y + height + PAD * 2 <= visibleBottom - host.clientHeight * 0.25;
    if (comfortable) return;
    host.scrollTo({ top: Math.max(0, y - margin), behavior: 'smooth' });
  }

  /** 标出循环段；不传参数则清除 */
  setLoop(from?: number, to?: number, pending = false): void {
    this.loopLayer.replaceChildren();
    if (from === undefined || to === undefined) return;
    for (let mi = from; mi <= to; mi++) {
      const b = this.boxes[mi];
      if (!b) continue;
      const el = document.createElement('div');
      el.className = 'loop-box';
      if (pending) el.classList.add('pending');
      if (mi === from) el.classList.add('first');
      if (mi === to) el.classList.add('last');
      el.style.width = `${b.w}px`;
      el.style.height = `${b.height + PAD * 2}px`;
      el.style.transform = `translate(${b.x}px, ${b.top - PAD}px)`;
      this.loopLayer.append(el);
    }
  }

  private handleTap(e: MouseEvent): void {
    if (!this.onTap) return;
    const rect = this.osmdEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestDist = Infinity;
    this.boxes.forEach((b, mi) => {
      if (!b || x < b.x || x > b.x + b.w) return;
      const dist = y < b.top ? b.top - y : y > b.top + b.height ? y - b.top - b.height : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = mi;
      }
    });
    if (best < 0 || bestDist > 60 * this.zoom) return;
    const list = this.steps[best] ?? [];
    let offset = 0;
    for (const s of list) if (s.x <= x + 10 * this.zoom) offset = s.offset;
    this.onTap(best, offset);
  }
}
