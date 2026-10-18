#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mk4220.py — 生成 v4.22.0 的迭代段 tools/iter181_seg.md 与抬版脚本 tools/bump_v4220.py。

抬版脚本由本文件从 tools/bump_v4210.py 派生（仓内唯一抬版口径，不另立第二份）。
段文件自查必须与 bump 脚本的 parse_items **同口径**：收集的是 `line.strip()` 后
以 `- ` 起头的整行、再 `it = line[2:]` 去前缀（v4.21.0 首版这里口径不一致，
self-check 把带前缀的整行拿去判 `startswith('【版本升至')` 而必然失配）。
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NL = chr(10)

SEG = '''## 迭代 181 — v4.22.0 · 第四期 R4-X1 可追问的往事会话
# 占位：下列条目由 tools/bump_v4220.py 写入 ITERATION_LOG.md 与本版 update-log 条目
- 【本版做的是第四期拓展项第一件:R4-X1 可追问的往事会话】计划原文要的是「真宿主完成五轮追问,明确换人后旧人物不残留;换会话或分支后旧结果不混入;歧义时让用户选择;真实模型参与的回答须逐句核来源,未实测不标效果已验」,并明写不做:不把它变成通用 AI 聊天 App、不无限保存对话全文、不由手机自己猜角色身份。
- 【修前实测的缺口(读码可复算,不是推演)】apps/memory/memory-app.js::askPast 每次只传 question 加空对象,回执里的 actor 与 topics 与 timeHints 一律被当成「这一问的临时结果」;memory-view 是单输入单结果区。于是用户问「那后来呢」「另一个人呢」时,上一轮认下的人与时点全部丢失 —— 后果不是报错,而是回答悄悄换了人:用户以为还在问甲,实际查的是全库。计划点名的正是这半句。
- 【新契约件 · config/memory-ask-thread.js(纯函数,零 DOM 零存储零联网零时钟)】六态追问面(不在场 / 本版没出口 / 还没开始 / 已认下 / 待消歧 / 上游说已结束)、三派发相(走追问 / 回落普通 / 连普通都没有)、轨迹滚动上限十二轮、候选上限八个,以及 normalizeThreadFace 与 carryLineOf 与 threadFaceLine 与 candidateRowsOf 与 traceLineOf 与 receiptOfStep 与 droppedTotalOf 与十二项自检。
- 【为什么继承不自己做】本仓纪律是同一口径只许一份实现。上游 qa-thread 内核已经带了 chatKey 作废重建(换会话不许暗中继承)与消歧未决不产结论两条硬约束;手机再写一份,就是把这两条硬约束放在两个地方各判一次。本件只做形状翻译:把上游回执翻成人能读的那几行。
- 【上游四态全认,含最容易被漏掉的第四态】上游 qa-thread 的四态是 idle 与 open 与 awaiting-disambig 与 closed。首版把 closed 落进 idle,于是「你结束了这一场」被读成「你还没开始」—— 处置相反(前者再追会重新认起条件,后者是从未开始)。本版单列该态并给它自己那句话。
- 【派发相严格判真】首版写的是宽松判,于是一个字符串或数字 1 都会被读成「有追问出口」,用户会点到一个走不通的按钮。与 config/ask-request.js::planAskPhase 同口径改成严格判,并把这条写进自检。
- 【本版自己抓到的第一处缺陷:换会话只作废了问答代际,没作废追问轨迹】上游 thread 带 chatKey 会自行作废重建,但轨迹是手机自己留的那一份:不作废就会把上一段会话的追问条件画进新会话那一屏 —— 用户看到「第 5 轮 · 人物 甲」而这一段一次都没追问过。不报错、只是错数据,正是本项要治的形态。
- 【本版自己抓到的第二处缺陷:消歧候选一个都拿不到】追问面读数原先只从上游 qaThread 读,而 qaThread 的读数里没有候选(也没有沿用轴)。后果在旧插件(只有追问口、没有 thread 读数口)上是「歧义时让用户选择」直接失效,在新插件上是「本次沿用哪些条件」那一屏永远显示不出来。改法是读数的**主**仍是上游 thread(它带 chatKey 作废重建,本层不能替),本会话最近那一轮追问回执只作**补**:同轮次时把沿用轴并进读数,旧插件上它就是唯一真源。
- 【本版自己抓到的第三处缺陷:累计读数被写成增量读数】轨迹滚动时原先只报「本次挤掉几轮」,而读数要说的「早前 N 轮不再回看」是累计总数(每次进一出一,增量恒为一)。改法是在轨迹数组上挂不可枚举的累计数(不可枚举是为了不污染结构比对),并由 App 侧唯一一口读出来。
- 【本版自己抓到的第四处缺陷:一屏永远显示不出「没有沿用任何条件」】carryLineOf 原先只要轮次有值就先塞「人物 (未认下)」,于是「这一轮压根没带条件」与「说了要沿用主体但名字没认出来」压成同一句 —— 两者处置相反。改成只在继承轴里真出现主体却没认下人时才说未认下。
- 【App 侧九口与三态出口】askThreadFace 与 askThreadLine 与 planAskFollowUpOutlet 与 askFollowUp 与 resolveAskPick 与 askTrace 与 askDroppedTotal 与 askCandidateRows 与 askThreadSelfCheck 与 askCarryLine。追问走上游唯一出口 askMemoryQuestionFollowUp;没有追问口时回落普通问答并**当面说清本次没有继承**(用户以为还在问甲、实际查了全库,是本项要治的那件事);插件不在场时如实说问不了,不报成没查到。
- 【消歧只读、不猜】未决时上游不跑查询,本层把候选原样交回视图让用户选;没选人时连上游都不去问(不替用户猜一个名字);用户点了一个候选里没有的名字,上游说不认就不认,保持待消歧、不产确定结论。
- 【视图只排版,取数全在控制器】「接着上一句」追问区:读数行与候选按钮与回话行与追问轨迹(只回看条件,不留答案全文),候选走容器级委托,轨迹行文案来自纯函数。追问面**独立于问答面**渲染:问答面读不出是常有的事,追问面此时照样该如实说出自己是哪一态(不连坐)。
- 【交棒改写】本版把 R4-X1 的验收从「问答能给答案」交棒到「第二句话还认得上一句的人」:判据一律写成真跑形(真 App 加假插件走完整旅程)与下限形(六态互不同形、负控制四条),并在内核侧钉住派发相严格判与撤销式的读数分形;下一版抬版无需二次改写。
- 【运行时验证边界(如实声明)】本版在无头环境验证的是:六态归一与分形、派发相三组合、轨迹滚动与累计读数、候选逐个可点、真 App 走完追问与回落与消歧点选与换会话作废、负控制四条(已结束不得读成没开始、换会话必须清轨迹、严格判真、累计读数、候选保住)。本版不能保证的是:真机浏览器上连着问五轮的实机旅程,以及真实模型参与时答案逐句来源的核对 —— 后者需要真模型在场,未实测故不标效果已验。
- 【定向判据与版本锚】新套件 tests/system-v4220.test.mjs 二十五例全绿(A 口径四、B 内核行为七、C 接线七、D 负控制六含正向对照、E 版本锚一);抬版按仓内唯一范式 tools/bump_v4220.py 对齐 tools/bump_v4210.py。
- 【版本升至 4.22.0（五源同源）】update-log 与 manifest 与 package 与 index.js 常量与公告块与 ITERATION_LOG 五处同步;本段共 17 条。
'''

DOC = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v4220.py — 抬 v4.22.0(五源同源,单版)。
范式沿用 tools/bump_v4210.py(同仓唯一抬版口径,不另立第二份)。
本版 v4.22.0 做的是第四期拓展项第一件:R4-X1 可追问的往事会话 ——
新增纯契约 config/memory-ask-thread.js(六态追问面 / 三派发相 / 轨迹滚动与累计读数 /
步到回执的形状翻译 / 十二项自检),
apps/memory/memory-app.js 增追问九口并修「换会话不作废轨迹」,
apps/memory/memory-view.js 增「接着上一句」追问区与消歧点选与轨迹一屏。
新增判据 tests/system-v4220.test.mjs 二十五例,新增 tools/iter181_seg.md(本版迭代段)。
"""'''


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def main():
    assert chr(92) not in SEG, 'seg must not contain backslash'
    assert '[' not in SEG and ']' not in SEG, 'seg must not contain brackets'
    # 与 bump 脚本 parse_items 同口径：strip 后以「- 」起头的整行，再去掉前缀。
    items = [l.strip()[2:].strip() for l in SEG.split(NL) if l.strip().startswith('- ')]
    assert len(items) >= 8, len(items)
    for it in items:
        assert it.startswith(chr(0x3010)), it[:24]
        assert chr(0x3011) in it, it[:24]
        assert chr(34) not in it, it[:24]
        assert chr(92) not in it, it[:24]
        assert '[' not in it and ']' not in it, it[:24]
    assert any(it.startswith('【版本升至') for it in items), 'missing closing item'
    assert any(it.startswith('【本版做的是') for it in items), 'missing subject item'
    assert any('运行时验证边界' in it for it in items), 'missing runtime-boundary item'
    assert any('本版自己抓到' in it for it in items), 'missing flaw-form item'
    assert any('交棒改写' in it for it in items), 'missing handoff item'
    wr('tools/iter181_seg.md', SEG)

    src = rd('tools/bump_v4210.py')
    old_doc_end = src.index('"""', src.index('"""') + 3) + 3
    body = src[old_doc_end:]
    old_steps = "    ('4.21.0', '2026-11-04', '4.20.0', 'tools/iter180_seg.md', 180),"
    new_steps = "    ('4.22.0', '2026-11-05', '4.21.0', 'tools/iter181_seg.md', 181),"
    assert body.count(old_steps) == 1, body.count(old_steps)
    body = body.replace(old_steps, new_steps, 1)
    wr('tools/bump_v4220.py', DOC + body)
    print('seg items %d | bump written' % len(items))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())