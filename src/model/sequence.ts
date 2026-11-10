import { Measure } from './types';

/**
 * 把反复记号、跳房子、D.C./D.S. 展开，得到实际演奏时的小节顺序。
 * 返回的是小节序号列表。
 */
export function unroll(measures: Measure[]): number[] {
  const order: number[] = [];
  const n = measures.length;
  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  /** D.C. / D.S. 跳回之后：不再反复，只走最后一个跳房子 */
  let jumped = false;
  const limit = n * 20 + 100;

  const afterEnding = (from: number): number => {
    for (let j = from; j < n; j++) if (measures[j].endingStop) return j + 1;
    return from + 1;
  };

  while (i < n && order.length < limit) {
    const m = measures[i];
    if (m.repeatStart && i !== repeatStart) {
      repeatStart = i;
      pass = 1;
    }

    if (m.endingStart) {
      let take: boolean;
      if (jumped) {
        // 不是最后一个跳房子的，结尾都带反复记号
        let stop = i;
        while (stop < n - 1 && !measures[stop].endingStop) stop++;
        take = measures[stop].repeatEnd === 0;
      } else {
        take = m.endingStart.includes(pass);
      }
      if (!take) {
        i = afterEnding(i);
        continue;
      }
    }

    order.push(i);

    if (jumped && m.fine) break;
    if (jumped && m.tocoda) {
      const coda = measures.findIndex((x, j) => j > i && x.coda);
      if (coda >= 0) {
        i = coda;
        continue;
      }
    }

    if (m.repeatEnd && !jumped) {
      if (pass < m.repeatEnd) {
        pass++;
        i = repeatStart;
        continue;
      }
      pass = 1;
      repeatStart = i + 1;
    } else if (m.endingStop && !m.repeatEnd) {
      // 走完最后一个跳房子，这一段反复结束
      pass = 1;
      repeatStart = i + 1;
    }

    if (!jumped && (m.dacapo || m.dalsegno)) {
      jumped = true;
      const segno = m.dalsegno ? measures.findIndex((x) => x.segno) : 0;
      i = Math.max(0, segno);
      continue;
    }
    i++;
  }
  return order;
}
