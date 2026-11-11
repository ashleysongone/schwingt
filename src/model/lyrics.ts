import { kid, kids, num } from './musicxml';

/**
 * 歌词。谱子文件里不带歌词，只标了“位置”：旋律的哪个音对第几个字
 * （写在 MusicXML 的 miscellaneous-field 里，格式是 “小节号:小节内位置=第几个字”，
 * 位置的单位和谱子里的 duration 一样）。歌词由使用者自己粘贴进来，只存在本机。
 * 重复的段落用同样的序号，所以歌词只要贴一遍。
 */
const SLOT_FIELD = 'schwingt-lyric-slots';

export interface LyricSlot {
  /** 小节号（谱面上写的，不是序号） */
  measure: string;
  pos: number;
  /** 对歌词里的第几个字，从 0 开始 */
  index: number;
}

export function lyricSlots(doc: Document): LyricSlot[] {
  const field = Array.from(doc.getElementsByTagName('miscellaneous-field')).find((f) => f.getAttribute('name') === SLOT_FIELD);
  const out: LyricSlot[] = [];
  for (const tok of (field?.textContent ?? '').trim().split(/\s+/)) {
    const m = /^([^:=]+):(\d+)=(\d+)$/.exec(tok);
    if (m) out.push({ measure: m[1], pos: Number(m[2]), index: Number(m[3]) });
  }
  return out;
}

/** 这份谱子用得上多少个字 */
export function lyricLength(slots: LyricSlot[]): number {
  return slots.reduce((n, s) => Math.max(n, s.index + 1), 0);
}

const WORD = /\p{Script=Han}|[\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{P}\p{S}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;

/**
 * 把粘贴进来的歌词拆成一个个字：汉字一个字一个，英文一个词一个，空格和标点不算。
 * 方括号里的时间标记、“作词：某某”这样的说明行会跳过。
 */
export function lyricTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\[[^\]]*\]/g, '');
    if (/^\s*[^\s:：]{1,8}\s*[:：]/.test(line)) continue;
    out.push(...(line.match(WORD) ?? []));
  }
  return out;
}

/**
 * 把歌词写到谱子上，直接改传进来的文档。歌词排在第一行谱表的音符下面第一行，
 * 原来写在那里的唱名往下挪一行。字不够时后面的位置空着，多出来的字不用。
 * @returns 写上去了多少个音符
 */
export function addLyrics(doc: Document, tokens: string[]): number {
  const byMeasure = new Map<string, Map<number, number>>();
  for (const s of lyricSlots(doc)) {
    let m = byMeasure.get(s.measure);
    if (!m) byMeasure.set(s.measure, (m = new Map()));
    m.set(s.pos, s.index);
  }
  const part = kids(doc.documentElement, 'part')[0];
  if (!byMeasure.size || !tokens.length || !part) return 0;

  const targets: { note: Element; text: string }[] = [];
  const firstStaff: Element[] = [];
  for (const measure of kids(part, 'measure')) {
    const slots = byMeasure.get(measure.getAttribute('number') ?? '');
    let pos = 0;
    for (const el of Array.from(measure.children)) {
      if (el.tagName === 'backup') pos = Math.max(0, pos - num(kid(el, 'duration')));
      else if (el.tagName === 'forward') pos += num(kid(el, 'duration'));
      if (el.tagName !== 'note') continue;
      const isChord = !!kid(el, 'chord');
      const start = pos;
      if (!isChord && !kid(el, 'grace')) pos += num(kid(el, 'duration'));
      if (Math.round(num(kid(el, 'staff'), 1)) !== 1) continue;
      firstStaff.push(el);
      // 和弦只在最上面那个音（写在最前面的）下面写字
      const index = isChord || !kid(el, 'pitch') ? undefined : slots?.get(start);
      if (index !== undefined && tokens[index]) targets.push({ note: el, text: tokens[index] });
    }
  }
  if (!targets.length) return 0;

  for (const note of firstStaff) {
    for (const l of kids(note, 'lyric')) l.setAttribute('number', String((parseInt(l.getAttribute('number') ?? '1', 10) || 1) + 1));
  }
  for (const { note, text } of targets) {
    const lyric = doc.createElement('lyric');
    lyric.setAttribute('number', '1');
    const syllabic = doc.createElement('syllabic');
    syllabic.textContent = 'single';
    const t = doc.createElement('text');
    t.textContent = text;
    lyric.append(syllabic, t);
    note.insertBefore(lyric, kid(note, 'lyric') ?? null);
  }
  return targets.length;
}
