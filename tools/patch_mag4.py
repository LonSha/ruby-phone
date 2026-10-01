#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_mag4.py — [v3.36.0] 首轮 15 红的逐条定性（产品侧 3 处 + 判据侧 9 处）。

═══ 产品侧（3 处，全部是真缺陷）═══
  P1 **代码里出现裸反引号**：`stripMarkdown` 的 `.replace(/\`([^\`]+)\`/g, '$1')`
     用的是正则字面量，而本仓判据共用的剥注释器（字符状态机）**不解析正则字面量**
     ⇒ 它把正则里的反引号当成模板串起头，**从那一行往后再也不复位** ⇒ 文件尾的
     注释（含 `AppState`）被当成代码 ⇒ D2 假红。修法：反引号用 `String.fromCharCode(96)`
     拼装、正则用 `new RegExp` 构造（与 pixiv 当年在 `_esc` 上踩的是同一个坑）。
  P2 **同类第二处**：App 的 `_fileName` 里 `.replace(/[\\\\/:*?"<>|]/g, '_')` 含裸双引号
     ⇒ 剥器在 app 文件上卡住 ⇒ D4 假红。修法：双引号用 `String.fromCharCode(34)` 拼装。
  P3 **TITLE 行尾部残留星号**：源正则的 `[\\*\\#\\s]*` 会吃掉 `**TITLE:**` 的**前导** `**`，
     捕获组只剩尾部的 `**`（`加粗标题**`），而 `stripMarkdown` 的 `\\*\\*(...)\\*\\*`
     需要成对 ⇒ 单独一个尾部记号剥不掉、会原样渲染出来。源八条链路一直带着这个尾巴。
     修法：拆标题时**先剥尾部孤立星号**再走 stripMarkdown（写明这是本件相对源的改进）。

═══ 判据侧（9 处，全部是判据自己写歪）═══
  J1 B2 口径错：空正文 `split('\\n')` 得 `['']` ⇒ 产一个 `gap` 块（源也这样产一个
     `magazine-qa-gap`）。判据写成「空正文不产块」—— 与源口径和本件实现都不符。
     改成「空正文**不含实质块**（只有 gap）+ unknown 为 0」。
  J2 C5 判据把**动态拼接的片段**当成类名（`class="mgz-face mgz-face-' + meta.tone + '"`）。
     修法：抓 `class="..."` 前先把拼接段（`' + ... + '`）整段抹成空格。
  J3 I1 破坏「期号是事实不是位置」后**判据没报**：破坏串 `index + 1` 在 `index=0` 时
     与真值等价 ⇒ 对「缺省期号」与「1.9 取整」两条断言**行为不变**（装饰断言）。
     修法：加一条**能暴露差异**的判据 —— 「**给定期号必须被尊重**」（vol:9 必须留 9；
     破坏后会被 index+1 抹成 1）。
  J4 I2 判据面没盖住破坏面：`nextVol` 根本没有判据。修法：加「期号必须取最大 + 1」
     （真：`[{vol:1},{vol:3}]` ⇒ 4；破坏成 `length + 1` ⇒ 3）。
  J5 I6 破坏「块 kind 白名单校验」**不可观测**（产品从不产白名单外的块 ⇒ 摘掉校验
     与不摘掉行为相同）。修法：破坏换成**可观测的等价形态** —— 白名单与解析器**脱节**
     （表里把 `'question'` 写成 `'question_typo'`），判据改成「产出的每个块都必须在
     白名单内」。并在注释里写明「摘掉校验」这一形态在无 stray 产出时不可观测。
  J6 I7 破坏把常量改名 ⇒ `timeAgoFace` 里 `MAGAZINE_TIME_UNITS` 未定义 ⇒ 判据
     **崩在 ReferenceError** 上（报红的原因不是判据响，是模块坏了）。修法：破坏改成
     **去掉 export**（内部仍可用、对外消失）⇒ 判据按 `Array.isArray` 如实报。
  J7 I9 锚点失配：App 里写的是 `nextVol(this.articles)`，DAMAGE 表里写的是
     `nextVol(arr)`（实测命中 0 次）。锚点与判据同步改。
  J8 I10 判据窗口过大：`appChatProblems` 取 `onChatChanged` 后 400 字，破坏后窗口
     里**含 render() 的 `this.probe()`** ⇒ 照样为真。修法：窗口取到**函数体结束**。
  J9 I11 判据数错了：`viewDeadProblems` 只查「文件里含 `[MAGAZINE_TIME_UNITS[`」，
     破坏掉五行里的一行后**其余四行仍在** ⇒ 照样为真。修法：数**出现次数必须 ≥ 5**。
"""
import io
import sys

E = []

# ══════════ P1 反引号（数据层）══════════
DATA = 'apps/magazine/magazine-data.js'
E.append((DATA,
    "        .replace(/`([^`]+)`/g, '$1')",
    "        .replace(MD_CODE_RE, '$1')",
    'P1a stripMarkdown 反引号正则改常量'))
E.append((DATA,
    "export function stripMarkdown(str) {",
    "/** ★ 反引号用 `String.fromCharCode(96)` 拼装、正则用 `new RegExp` 构造 ——\n"
    " *  **不许在代码里写裸反引号**：本仓判据共用的剥注释器是字符状态机、不解析正则字面量，\n"
    " *  一旦正则里出现裸反引号，剥器就把它当成模板串起头、**从那一行往后再也不复位**，\n"
    " *  文件尾注释里的词会被当成代码（v3.31.0 在 date-view、v3.35.0 在 pixiv 的 `_esc` 上\n"
    " *  各踩过一次）。 */\n"
    "const BT = String.fromCharCode(96);\n"
    "const MD_CODE_RE = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');\n"
    "export function stripMarkdown(str) {",
    'P1b 数据层加 BT / MD_CODE_RE'))

# ══════════ P2 双引号（App 层）══════════
APP = 'apps/magazine/magazine-app.js'
# ② 类前加两个常量（插在 `export class MagazineApp {` 之前）
E.append((APP,
    "export class MagazineApp {",
    "/** ★ 双引号同样用拼装形（见数据层 `BT` 的注释）—— 裸双引号会让剥注释器在\n"
    " *  `'...'` 之外卡住（本仓纪律：代码里不许出现会骗过状态机的裸引号）。 */\n"
    "const DQ = String.fromCharCode(34);\n"
    "const BAD_FILE_CHARS = new RegExp('[\\\\/:*?' + DQ + '<>|]', 'g');\n"
    "\n"
    "export class MagazineApp {",
    'P2a 类前加 DQ / BAD_FILE_CHARS'))
# ③ _fileName 里的字面量正则改用常量
E.append((APP,
    "        const s = String(base || 'article').slice(0, 30).replace(/[\\\\/:*?\"<>|]/g, '_');",
    "        const s = String(base || 'article').slice(0, 30).replace(BAD_FILE_CHARS, '_');",
    'P2b _fileName 用常量'))

# ══════════ P3 TITLE 尾部星号 ══════════
E.append((DATA,
    "    const m = s.match(/^[\\*\\#\\s]*TITLE:[\\*\\#\\s]*(.+)/im);\n"
    "    const title = m ? stripMarkdown(m[1].trim()) : '';",
    "    const m = s.match(/^[\\*\\#\\s]*TITLE:[\\*\\#\\s]*(.+)/im);\n"
    "    /* ★ 先剥**尾部孤立的星号**再走 stripMarkdown：源那条正则的 `[\\*\\#\\s]*` 会吃掉\n"
    "     *  `**TITLE:**` 的**前导** `**`，捕获组于是只剩尾部的 `**`（`加粗标题**`）——\n"
    "     *  而 stripMarkdown 的成对记号剥不掉单个尾部记号，会原样渲染出来。\n"
    "     *  这是本件相对源的一处**改进**（源那八条链路一直带着这个尾巴）。 */\n"
    "    const title = m ? stripMarkdown(m[1].trim().replace(/\\*+$/, '').trim()) : '';",
    'P3 TITLE 先剥尾部星号'))


def main(write):
    bad = 0
    for path, old, new, label in E:
        text = io.open(path, encoding='utf-8').read()
        n = text.count(old)
        if n != 1:
            print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
            bad += 1
            continue
        if write:
            io.open(path, 'w', encoding='utf-8').write(text.replace(old, new, 1))
            print('OK   %s' % label)
        else:
            print('DRY  %s' % label)
    if bad:
        print('失配 %d 处' % bad)
        sys.exit(1)
    print('全部完成' if write else '（dry-run）')


main('--write' in sys.argv)