export interface ActiveKey {
  midi: number;
  track: number;
  label: string;
}

const BLACK = new Set([1, 3, 6, 8, 10]);

/** 屏幕上的钢琴键盘：按谱子的音域自动取范围，正在弹的键按左右手着色 */
export class Keyboard {
  private readonly keys = new Map<number, HTMLElement>();
  private readonly labels = new Map<number, HTMLElement>();
  private active = new Map<number, string>();
  private lo = 48;
  private hi = 84;

  constructor(
    private readonly host: HTMLElement,
    private readonly onPress?: (midi: number) => void,
  ) {
    host.classList.add('kb');
    host.addEventListener('pointerdown', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('.key');
      if (!key) return;
      e.preventDefault();
      this.onPress?.(Number(key.dataset.midi));
      key.classList.add('pressed');
      window.setTimeout(() => key.classList.remove('pressed'), 160);
    });
    this.build();
  }

  /** 按谱子里的最低音和最高音定键盘范围，两端补齐到整八度 */
  setRange(lowest: number, highest: number): void {
    let lo = Math.floor((lowest - 2) / 12) * 12;
    let hi = Math.ceil((highest + 2) / 12) * 12;
    // 至少显示 C3 到 C6 这三个八度，总包含中央 C
    lo = Math.min(lo, 48);
    hi = Math.max(hi, 84);
    lo = Math.max(lo, 12);
    hi = Math.min(hi, 108);
    if (lo === this.lo && hi === this.hi) return;
    this.lo = lo;
    this.hi = hi;
    this.build();
  }

  private build(): void {
    this.keys.clear();
    this.labels.clear();
    this.active = new Map();
    this.host.replaceChildren();
    let whites = 0;
    for (let m = this.lo; m <= this.hi; m++) if (!BLACK.has(m % 12)) whites++;
    const ww = 100 / whites;
    const bw = ww * 0.62;
    let w = 0;
    for (let m = this.lo; m <= this.hi; m++) {
      const black = BLACK.has(m % 12);
      const key = document.createElement('div');
      key.className = black ? 'key black' : 'key white';
      key.dataset.midi = String(m);
      const lab = document.createElement('span');
      lab.className = 'lab';
      key.append(lab);
      if (black) {
        key.style.left = `${w * ww - bw / 2}%`;
        key.style.width = `${bw}%`;
      } else {
        key.style.left = `${w * ww}%`;
        key.style.width = `${ww}%`;
        if (m % 12 === 0) {
          const octave = m / 12 - 1;
          key.dataset.rest = octave === 4 ? '中央C' : `C${octave}`;
          if (octave === 4) key.classList.add('middle');
          lab.textContent = key.dataset.rest;
        }
        w++;
      }
      this.keys.set(m, key);
      this.labels.set(m, lab);
      this.host.append(key);
    }
  }

  setActive(list: ActiveKey[]): void {
    const next = new Map<number, string>();
    for (const a of list) {
      const prev = next.get(a.midi);
      // 两只手同时落在一个键上时，按右手显示
      if (prev === undefined || a.track === 0) next.set(a.midi, `${a.track}|${a.label}`);
    }
    for (const [midi, sig] of this.active) {
      if (next.get(midi) === sig) continue;
      const key = this.keys.get(midi);
      if (!key) continue;
      key.classList.remove('on', 't0', 't1', 't2');
      this.labels.get(midi)!.textContent = key.dataset.rest ?? '';
    }
    for (const [midi, sig] of next) {
      if (this.active.get(midi) === sig) continue;
      const key = this.keys.get(midi);
      if (!key) continue;
      const sep = sig.indexOf('|');
      const track = Number(sig.slice(0, sep));
      key.classList.remove('t0', 't1', 't2');
      key.classList.add('on', `t${Math.min(track, 2)}`);
      this.labels.get(midi)!.textContent = sig.slice(sep + 1);
    }
    this.active = next;
  }
}
