import { strFromU8, unzipSync } from 'fflate';

function decode(bytes: Uint8Array): string {
  // 部分打谱软件导出的是 UTF-16
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** 读出 MusicXML 文本。支持 .musicxml / .xml，以及压缩格式 .mxl */
export function readMusicXml(data: ArrayBuffer, fileName: string): string {
  const bytes = new Uint8Array(data);
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    if (/\.pdf$/i.test(fileName) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      throw new Error('PDF 谱子不能直接导入，需要 MusicXML 或 MIDI 文件');
    }
    return decode(bytes);
  }

  const files = unzipSync(bytes);
  let rootPath: string | undefined;
  const container = files['META-INF/container.xml'];
  if (container) {
    const m = /<rootfile[^>]*full-path="([^"]+)"/.exec(strFromU8(container));
    if (m) rootPath = m[1];
  }
  if (!rootPath || !files[rootPath]) {
    rootPath = Object.keys(files).find((p) => !p.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(p));
  }
  if (!rootPath || !files[rootPath]) throw new Error('压缩包里没有找到谱子文件');
  return decode(files[rootPath]);
}
