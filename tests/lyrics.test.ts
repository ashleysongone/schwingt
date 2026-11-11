import { describe, expect, it } from 'vitest';
import { withLabels } from '../src/model/labels';
import { addLyrics, lyricLength, lyricSlots, lyricTokens } from '../src/model/lyrics';
import { parseXml } from '../src/model/musicxml';

const note = (step: string, dur: number, extra = ''): string =>
  `<note>${extra.includes('<chord/>') ? '<chord/>' : ''}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${dur}</duration>${extra.replace('<chord/>', '')}<staff>1</staff></note>`;

/** 两小节的小谱子：第一小节 do re（re 上叠一个 fa）mi，第二小节 sol 和一个休止；左手一个全音符 */
function scoreWith(slots: string): string {
  const left = '<backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>';
  return (
    '<?xml version="1.0"?><score-partwise>' +
    `<identification><miscellaneous><miscellaneous-field name="schwingt-lyric-slots">${slots}</miscellaneous-field></miscellaneous></identification>` +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">' +
    '<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>' +
    `${note('C', 1)}${note('F', 1)}${note('D', 1, '<chord/>')}${note('E', 2)}${left}</measure>` +
    `<measure number="2">${note('G', 2)}<note><rest/><duration>2</duration><staff>1</staff></note>${left}</measure>` +
    '</part></score-partwise>'
  );
}

/** 第一行谱表上每个音符下面的字，一行一个数组 */
function rows(doc: Document): string[][] {
  const out: string[][] = [];
  for (const n of Array.from(doc.getElementsByTagName('note'))) {
    if (n.getElementsByTagName('staff')[0]?.textContent !== '1') continue;
    for (const l of Array.from(n.getElementsByTagName('lyric'))) {
      const row = Number(l.getAttribute('number')) - 1;
      (out[row] ??= []).push(l.getElementsByTagName('text')[0].textContent ?? '');
    }
  }
  return out;
}

describe('歌词', () => {
  it('把贴进来的歌词拆成字：汉字一个字一个，英文一个词一个，标点和空格不算', () => {
    expect(lyricTokens('一二三 四，五\n\nhello world 六')).toEqual(['一', '二', '三', '四', '五', 'hello', 'world', '六']);
  });

  it('跳过说明行和时间标记', () => {
    expect(lyricTokens('歌名\n作词：某某\n作曲: 某某\n[00:12.50]一二\n[00:15.00] 三四')).toEqual(['歌', '名', '一', '二', '三', '四']);
  });

  it('读出谱子里标的歌词位置', () => {
    const doc = parseXml(scoreWith('1:0=0 1:1=1 1:2=2 2:0=0'));
    expect(lyricSlots(doc)).toEqual([
      { measure: '1', pos: 0, index: 0 },
      { measure: '1', pos: 1, index: 1 },
      { measure: '1', pos: 2, index: 2 },
      { measure: '2', pos: 0, index: 0 },
    ]);
    expect(lyricLength(lyricSlots(doc))).toBe(3);
    expect(lyricLength(lyricSlots(parseXml(scoreWith(''))))).toBe(0);
  });

  it('按位置把字写到旋律下面，重复的位置用同一个字，多出来的字不用', () => {
    const doc = parseXml(scoreWith('1:0=0 1:1=1 1:2=2 2:0=0'));
    expect(addLyrics(doc, ['甲', '乙', '丙', '丁', '戊'])).toBe(4);
    expect(rows(doc)).toEqual([['甲', '乙', '丙', '甲']]);
  });

  it('字不够时后面的位置空着；没有歌词或谱子没标位置时什么都不改', () => {
    const doc = parseXml(scoreWith('1:0=0 1:1=1 1:2=2'));
    expect(addLyrics(doc, ['甲'])).toBe(1);
    expect(rows(doc)).toEqual([['甲']]);
    expect(addLyrics(parseXml(scoreWith('1:0=0')), [])).toBe(0);
    const bare = parseXml(scoreWith(''));
    expect(addLyrics(bare, ['甲'])).toBe(0);
    expect(bare.getElementsByTagName('lyric')).toHaveLength(0);
  });

  it('歌词排在第一行，唱名往下挪；和弦只在最上面的音下面写字，左手不动', () => {
    const src = parseXml(scoreWith('1:0=0 1:1=1 1:2=2'));
    const doc = withLabels(src, { mode: 'fixed', tracks: new Set([0, 1]) });
    addLyrics(doc, ['甲', '乙', '丙']);
    expect(rows(doc)).toEqual([
      ['甲', '乙', '丙'],
      ['do', 'fa', 'mi', 'sol'],
      ['re'],
    ]);
    const leftLyric = Array.from(doc.getElementsByTagName('note')).filter((n) => n.getElementsByTagName('staff')[0]?.textContent === '2')[0].getElementsByTagName('lyric')[0];
    expect(leftLyric.getAttribute('number')).toBe('1');
  });
});
