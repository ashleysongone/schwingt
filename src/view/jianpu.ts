import { splitDots } from '../model/solfege';

// 简谱的高低音点。唱名里的点是用组合字符记的（数字后面跟着“上面一点”“下面一点”），
// 字体对它们的摆放靠不住：点会偏到数字右边，两个点会叠成一个。所以显示的时候把组合字符拿掉，自己画点。

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 谱面排好之后调用：把谱面上带点的简谱数字换成“数字 + 画出来的圆点” */
export function drawDotsInSvg(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: { node: Text; text: string; dots: number }[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const { text, dots } = splitDots(node.data);
    if (dots) found.push({ node, text, dots });
  }
  for (const { node, text, dots } of found) {
    const el = node.parentElement as unknown as SVGTextContentElement | null;
    if (!el || typeof el.getExtentOfChar !== 'function') continue;
    node.data = text;
    // 点对着数字（最后一个字符）的正中，升降号不算
    const digit = el.getExtentOfChar(el.getNumberOfChars() - 1);
    const baseline = el.getStartPositionOfChar(el.getNumberOfChars() - 1).y;
    const size = parseFloat(getComputedStyle(el).fontSize) || digit.height;
    for (let k = 0; k < Math.abs(dots); k++) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(digit.x + digit.width / 2));
      dot.setAttribute('cy', String(dots > 0 ? baseline - size * (0.82 + 0.2 * k) : baseline + size * (0.16 + 0.2 * k)));
      dot.setAttribute('r', String(size * 0.06));
      dot.setAttribute('fill', 'currentColor');
      dot.setAttribute('class', 'jianpu-dot');
      el.parentNode?.appendChild(dot);
    }
  }
}

/** 网页里的唱名（键盘上的、工具栏下面那一行的）：几个唱名排成一行，带点的数字用小圆点画出来 */
export function showLabels(host: HTMLElement, labels: string[]): void {
  const sig = labels.join(' ');
  if (host.dataset.labels === sig) return;
  host.dataset.labels = sig;
  host.textContent = '';
  labels.forEach((label, i) => {
    if (i) host.append(' ');
    const { text, dots } = splitDots(label);
    if (!dots) {
      host.append(text);
      return;
    }
    host.append(text.slice(0, -1));
    const digit = document.createElement('span');
    digit.className = 'jianpu';
    digit.textContent = text.slice(-1);
    const stack = document.createElement('span');
    stack.className = dots > 0 ? 'jianpu-dots up' : 'jianpu-dots down';
    for (let k = 0; k < Math.abs(dots); k++) stack.append(document.createElement('i'));
    digit.append(stack);
    host.append(digit);
  });
}
