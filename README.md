# Schwingt 钢琴练习

自己用的钢琴练习工具：导入五线谱，电脑弹一只手，我跟另一只手。

## 启动

双击 `start.cmd`，浏览器会打开 <http://localhost:5173/>。
第一次运行会自动安装依赖，需要本机装有 Node.js。

平板上用：电脑和平板连同一个 Wi-Fi，启动后终端里会显示一行 `Network: http://192.168.x.x:5173/`，
在平板浏览器里打开这个地址。第一次 Windows 防火墙可能会询问是否允许 Node 联网，选允许。

## 现在能做什么

- 导入 MusicXML 谱子（`.musicxml` / `.xml` / `.mxl`）或 MIDI（`.mid`），导入的谱子保存在浏览器本地曲库里
- 每只手单独选“电脑弹”或“我来弹”
- 变速（原速的 30%–120%），节拍器，预备拍
- 选段循环：点“选段”，在谱子上点第一个小节和最后一个小节
- 逐个音前进后退（← →），点谱面上的音符可以直接跳过去并听到它
- 唱名：每只手单独开关，可选固定调、首调、简谱数字、音名
- 屏幕键盘按左右手着色显示当前要按的键

快捷键：空格 播放/暂停，← → 逐个音，Home 回到开头，M 节拍器，L 循环，Esc 取消选段。

关于 MIDI：MIDI 里没有记谱信息，五线谱是自动转出来的。节奏对齐到十六分音符，每只手只记一个声部，
调号和中途转调是按用到的音推断的，和正式谱子会有出入；播放时的音长仍按 MIDI 原样。
有正式的 MusicXML 时优先用它。

## 后续计划

1. （已完成）导入、谱面和键盘显示、分手播放、变速、循环、节拍器、预备拍、唱名
2. 接电钢琴：等待模式（弹对了再往下走）、错音统计
3. 踏板线和和弦标注，把左手拆成“和弦 + 固定弹法”来理解
4. 练习地图（每句分左手、右手、合手记录掌握程度）、连续弹对后自动提速

## 开发

```
npm run dev                              启动开发服务
npm test                                 模型层单元测试
npm run build                            类型检查并打包到 dist/
node scripts/e2e.mjs                     用本机 Edge 无界面跑一遍主要功能（需要先启动开发服务）
node scripts/check-score.mjs <谱子文件>   导入一份谱子，核对解析和光标定位（需要先启动开发服务）
node scripts/make-demo.mjs               重新生成示例曲
node scripts/make-easy-fanfangxiang.mjs  重新生成《反方向的钟》C 调简化版（加 --print 逐小节列出，加 --keep-rhythm 保留原节奏）
node scripts/check-repo.mjs              提交前检查（见下）
```

### 提交前检查

新克隆仓库后运行一次，启用提交钩子：

```
git config core.hooksPath .githooks
```

之后每次提交会自动检查两件事，有问题就拒绝提交：

- 文本文件里不能是二进制内容。有的电脑上安全软件会把文件在磁盘上换成加密格式，这样的文件提交上去就是乱码。
- 不能出现“不想公开的词”。在仓库根目录建一个 `.private-words` 文件，一行一个词（比如真实姓名、单位名、电脑用户名）。
  这个文件本身不会被提交。没有这个文件就跳过这项检查。

目录：

- `src/model` 谱子解析、反复展开、播放时间线、唱名、MIDI 转五线谱
- `src/io` 文件读取（MusicXML、MIDI）和本地曲库
- `src/audio` 钢琴音色和播放调度
- `src/view` 谱面显示和屏幕键盘
- `public/scores` 自带曲库，`index.json` 是目录
- `public/samples/piano` 钢琴采样
- `scores-raw` 下载的原始谱子文件和备选版本（不进仓库）

## 素材来源

钢琴采样取自 Salamander Grand Piano V3（Alexander Holm，CC BY 3.0），经 Tone.js 项目整理。

曲库里三首曲子的 MIDI 都是网友扒的谱，只用于个人练习：

- 《晴天》：GitHub 上 AutoPiano 项目里的 `static/midi/晴天.mid`
- 《The Truth That You Leave》：OnlineSequencer 上的公开序列 5559401，按网站的导出规则转成 MIDI
- 《反方向的钟》：OnlineSequencer 上的公开序列 3955810，同样转成 MIDI
- 《反方向的钟（C 调简化版）》：用 `scripts/make-easy-fanfangxiang.mjs` 从上面那份完整扒谱生成。
  旋律取最高声部并移到 C 大调，节奏拉直到八分音符，左手每个和弦弹三个音，只收前奏、主歌、导歌、副歌各一遍

这些曲子的版权归原作者所有，扒谱只供个人练习，请不要拿去商用。
