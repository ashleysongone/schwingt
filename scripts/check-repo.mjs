// 提交前检查，避免把不该进仓库的东西提交上去。
// 用法：node scripts/check-repo.mjs            检查工作目录里所有会被 git 管理的文件
//       node scripts/check-repo.mjs --staged   只检查这次要提交的内容（提交钩子用这个）
//
// 检查两件事：
// 1. 文本文件里不能是二进制内容。有的电脑上安全软件会把文件在磁盘上换成加密格式，
//    这样的文件一旦提交，仓库里存的就是乱码。
// 2. 不能出现“不想公开的词”。词表放在仓库根目录的 .private-words 里，一行一个，
//    这个文件本身不进仓库；没有这个文件就跳过这项检查。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const TEXT = /\.(md|txt|ts|tsx|js|mjs|cjs|json|html|css|cmd|sh|yml|yaml|xml|musicxml)$|(^|\/)\.[a-z]+$|^\.githooks\//i;
const staged = process.argv.includes('--staged');
const git = (args) => execFileSync('git', args, { maxBuffer: 1 << 28 });

const files = (staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']) : git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']))
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const words = existsSync('.private-words')
  ? readFileSync('.private-words', 'utf8')
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && !w.startsWith('#'))
  : [];

const problems = [];
for (const file of files) {
  const lowerName = file.toLowerCase();
  for (const w of words) if (lowerName.includes(w)) problems.push(`${file}：文件名里有不想公开的词`);
  if (!TEXT.test(file)) continue;
  let data;
  try {
    data = staged ? git(['show', `:${file}`]) : readFileSync(file);
  } catch {
    continue;
  }
  if (data.subarray(0, 8192).includes(0)) {
    problems.push(`${file}：文本文件里是二进制内容，可能被加密了`);
    continue;
  }
  if (!words.length) continue;
  const lines = data.toString('utf8').toLowerCase().split('\n');
  lines.forEach((line, i) => {
    // 只报行号，不把那个词打印出来
    if (words.some((w) => line.includes(w))) problems.push(`${file} 第 ${i + 1} 行：有不想公开的词`);
  });
}

if (problems.length) {
  console.error(`不能提交，有 ${problems.length} 处问题：\n  ${problems.slice(0, 40).join('\n  ')}`);
  process.exit(1);
}
console.log(`检查了 ${files.length} 个文件，没有问题${words.length ? '' : '（没有 .private-words，未检查不想公开的词）'}`);
