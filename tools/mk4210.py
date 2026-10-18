#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mk4210.py — 生成 v4.21.0 的迭代段 tools/iter180_seg.md 与抬版脚本 tools/bump_v4210.py。
抬版脚本本身由本文件从 tools/bump_v4200.py 派生(仓内唯一抬版口径,不另立第二份)。
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NL = chr(10)

SEG = '''## 迭代 180 — v4.21.0 · 第四期 R4-O9 本地附件随备份真正搬走
# 占位:下列条目由 tools/bump_v4210.py 写入 ITERATION_LOG.md 与本版 update-log 条目
- 【本版做的是第四期优化项第九件:R4-O9 本地附件随备份真正搬走】计划原文要的是「在空存储环境恢复一本 TXT、一本 EPUB 及摘录与进度,离线可读且正文 hash 相同;中断或配额不足不报完整恢复;重复导入不产生双书,删除附件前列清引用它的书架项」,并明写不做:不静默下载外链图片、不上传云端、不把完整手机备份用于仅含元数据的包。
- 【修前实测的缺口(读码可复算,不是推演)】config/data-backup.js 的备份模型只围绕 storage 键,而书库正文在 apps/reading/reading-attachment.js 的 indexedDB 里 —— 两个面互不相识。后果不是备份失败,而是备份从没打算搬正文:换设备后书架条目还在,点开一本书是空的。整改前那一版的三条读数(导出前看不清搬的是什么、恢复只演了一半、撤完附件还在)全部出自这同一处。
- 【新契约件 · config/library-backup.js(纯函数,零 DOM 零存储零联网零时钟)】四段(书架条目/书籍正文/摘录标记/阅读进度)一起走;核心口是 buildLibraryPack 与 planLibraryImport 与 commitLibraryImport 与 undoLibraryImport,另有 chaptersToText 与 textToChapters 严格互逆、readLibraryPack 六态、migrateLibraryPack 两条路、三行读数与十一项自检。config 分层纪律照旧:不 import apps,依赖面恰好是零依赖叶子 num-gate。
- 【包魔标与整机备份刻意不同】书库包用 yuzuki-phone-library,整机备份用 yuzuki-phone-backup。两种包身份混用会让导入侧拿 storage 规则去读正文包,读出来的是一份「看着像包」的空壳。未来版本明确拒、无魔标按兼容面收下但必须走迁移,不猜字段、不跳步改写。
- 【未包含清单不是免责声明,是导出前要给用户看的那一屏】四项常驻且逐项写人话:远端资源(不替你去下载)、其它设备上的附件(本机存储搬不走)、超出配额的部分(如实记为未包含,不做静默截断)、仅在内存里的正文(关掉页面即丢)。用户有权在导出前知道哪些东西不会跟着走,而不是到新机器上才发现。
- 【正文一律转文本,引用型不得当已搬走】对象 URL 与远端路径换设备即失效,包里带上它只会让新机器上多一本打不开的书,故引用型载体如实记为未包含并写明换设备即失效。
- 【超限如实记为未包含,绝不截断】单本上限与附件层同源口径(八兆字节),超限那本进不了包并如实记账未包含体积与理由 —— 半个正文在新机器上是一本坏书,比缺正文更难查。
- 【完整性只在正文这一格判】摘录与进度为空是正常状态(新书就是空的),把空摘录判成不完整会让每本新书都报残缺;正文缺席才是打不开。缺口默认拒收,只有用户显式允许部分导入才放行。
- 【本版自己抓到的第一处缺陷:静默空包】refsOf 的书架键只认 s.id,而书库包条目用 bookId,两种形态相遇时 bookId 形态的数组被静默丢空 —— 导出的包写着零本,而同一屏的扫描行还说着两本。静默空包与「书目搬走了书是空的」是同一族形态:看起来没坏,只是东西没了。改法是把两形态都认下来,判据按两个形态各核一遍。
- 【本版自己抓到的第二处缺陷:摘录写口没跟计划同一个源】原写法把包里的摘录无条件全量并回,于是包里的书整本被拒收(缺正文)时,新机器上仍会出现指着一段不存在的正文的摘录 —— 而摘录的全部价值就是回跳定位。改成只并回落成的那几本;一行都没写时不报已导入。
- 【本版自己抓到的第三处缺陷:正文写失败仍落下书架条目】原写法先大循环落书架、再大循环写正文,配额一满(正文一本都没写进去)时新机器上留下的正是两本打不开的书 —— 与本项要治的病是同一件事,只是换了边。改成逐书为单位,正文先落、书架后认领:写不进去的那本一个字都不落下,并把失败本数与编号如实交回读数。
- 【本版自己抓到的第四处缺陷:撤销留孤儿且报假成功】撤销写口按 kind 分叉,新增书的正文与书架动作被判成 restore-body 与 restore-book —— App 侧不认识这两个动作,兜底分支把它们计成成功,界面报着已撤销四项而附件层两份正文一份没删。用户不会去检查附件层,本机存储就一直被占着。假成功比失败更坏,这是本项重点防的形态。撤本次写入的正确口径只有一种:把本次写进去的那份删掉。
- 【App 侧兜底分支不许把不认识的动作用计成成功】撤销改为分开计成功与未成,删除结果要真读(附件层会如实给 denied 与 writer-error 与无附件层),未成或未知动作如实报并明确不计入成功。
- 【删附件之前先列清引用它的书架项】附件层是本机存储,删掉就没了;而引用它的不止书架条目 —— 进度键与摘录条目都按 bookId 指过来。这一口把三样都列出来(书架条目与摘录条数与进度章),没有书架项引用时明说这是删书漏删留下的孤儿正文。
- 【视图只做四步与一屏读数,判定全在内核】扫描书库与导出书库包与预演导入与确认导入与撤销本次导入五个按钮,逐本四段表按完整与缺正文分列并红字点名,包里的书与包外的孤儿正文分开列。刻意不碰整机备份面的四动作白名单,免得把别人的判据转红。
- 【交棒改写】本版把 R4-O9 的验收从「备份成功」交棒到「换一台空机器真的读得到同一本书」:判据一律写成真跑形(真 App 加本机 indexedDB 假件跑完整旅程)与下限形,并在内核侧钉住撤销动作只许出 App 认识的那两种;下一版抬版无需二次改写。
- 【运行时验证边界(如实声明)】本版在无头环境验证的是:四段齐全、正文进包并能在空存储上原样回读(文本逐字相同)、配额不足如实报 partial 且不留打不开的书、重复导入不产生双书、拒收那本的摘录不并回、撤销动作不越界且附件真被清掉、删附件前列清引用。本版不能保证的是:真机浏览器上点完这五个按钮的实机旅程,以及 EPUB 解析器与图床一类外部来源的表现;这些留给运行时装机复校。
- 【定向判据与版本锚】新套件 tests/system-v4210.test.mjs 三十一例全绿(A 口径四、B 内核行为九、C 接线八、D 负控制九含正向对照、E 版本锚一);抬版按仓内唯一范式 tools/bump_v4210.py 对齐 tools/bump_v4200.py。
- 【版本升至 4.21.0（五源同源）】update-log 与 manifest 与 package 与 index.js 常量与公告块与 ITERATION_LOG 五处同步;本段共 19 条。
'''

DOC = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v4210.py — 抬 v4.21.0(五源同源,单版)。
范式沿用 tools/bump_v4200.py(同仓唯一抬版口径,不另立第二份)。
本版 v4.21.0 做的是第四期优化项第九件:R4-O9 本地附件随备份真正搬走 ——
新增纯内核 config/library-backup.js(四段一包 / 六态读包 / 两条迁移 / 逐书导入计划 / 撤销 / 自检),
apps/reading/reading-data.js 增按 id 就地的导入写口 adoptBook,
apps/reading/reading-app.js 接书库四段并补 bodyRefsOf(删附件前先列引用),
apps/reading/reading-view.js 加书库备份区五步与逐本四段表。
新增判据 tests/system-v4210.test.mjs 三十一例,新增 tools/iter180_seg.md(本版迭代段)。
"""
'''


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def main():
    # 段文件自检:不含反斜杠、不含方括号、至少八条、四个锚点齐
    assert chr(92) not in SEG, 'seg must not contain backslash'
    assert '[' not in SEG and ']' not in SEG, 'seg must not contain brackets'
    items = [l[2:] for l in SEG.split(NL) if l.startswith('- ')]
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
    wr('tools/iter180_seg.md', SEG)

    src = rd('tools/bump_v4200.py')
    old_doc_end = src.index('"""', src.index('"""') + 3) + 3
    body = src[old_doc_end:]
    old_steps = "    ('4.20.0', '2026-11-03', '4.19.0', 'tools/iter179_seg.md', 179),"
    new_steps = "    ('4.21.0', '2026-11-04', '4.20.0', 'tools/iter180_seg.md', 180),"
    assert body.count(old_steps) == 1, body.count(old_steps)
    body = body.replace(old_steps, new_steps, 1)
    wr('tools/bump_v4210.py', DOC + body)
    print('seg items %d | bump written' % len(items))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())