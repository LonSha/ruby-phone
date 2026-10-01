# -*- coding: utf-8 -*-
"""[v3.35.0] 第二批：三处真缺陷（由自跑探测当场暴露，不是门禁抓的）。

① `heartsFace` 报 `consistent: false` —— 我写的修法是
   `hearts = Math.max(maxCh, 缓存值)`，于是**比逐章大的缓存值照样留着**：
   视图显示「♡ 999」而逐章最高只有 30，正是本件要挡的那类「自洽地错」。
   修法：有章时**一律以逐章为准**（缓存值不参与），无章时才用存量值。

② `commentCountFace` 把 `commentsFailed: true` 判成 `not_read` ——
   顺序把「没读过」放在最前，失败态被它吞了。失败**不是**没读过：
   一个是「还没试」，一个是「试了没成」。修法：失败态优先。

③ `sanitizeBody` 对非法属性值**重复计数**（`<details class="evil">` 计 2）：
   一次是「值不合规」、一次是 `!kept && attrText.trim()` 的兜底。
   同一个属性不该进两个格子。修法：兜底只在**没有任何属性被处理过**时触发。
"""
import io
import sys

PATH = 'apps/pixiv/pixiv-data.js'
EDITS = []


def edit(old, new, label):
    EDITS.append((old, new, label))


# ① hearts 缓存以逐章为准
edit("""        // ★ 缓存值**必须与逐章读数一致**：源 `_recalcNovelHearts` 只在创建 /
        //   迁移时算一次，之后重写单章会让缓存与逐章永久不一致。本件在这里
        //   一律以逐章为准重算，坏值不参与。
        hearts: Math.max(chapters.length ? maxCh : 0, heartN === null ? 0 : Math.max(0, Math.trunc(heartN))),""",
     """        // ★ 缓存值**必须与逐章读数一致**：源 `_recalcNovelHearts` 只在创建 /
        //   迁移时算一次，之后重写单章会让缓存与逐章永久不一致。
        //   本件在这里一律**以逐章为准**（有章就不看存量值）—— 首版写成
        //   `Math.max(maxCh, 存量)`，于是「比逐章大的存量值」照样留着：
        //   视图显示缓存那个大数、逐章最高却是小数，正是本件要挡的那类自洽错。
        hearts: chapters.length ? maxCh : (heartN === null ? 0 : Math.max(0, Math.trunc(heartN))),""",
     'hearts')

# ② 失败态优先
edit("""    const face = (!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? 'not_read'
        : (ch.commentsFailed ? 'failed' : (ch.commentsLoaded ? 'read' : 'partial'));""",
     """    // ★ 顺序即语义：失败**不是**「没读过」（一个是「还没试」、一个是「试了没成」），
    //   故失败态必须排在 not_read 之前 —— 首版把它排在后面，失败被静默吞成「没读过」。
    const face = ch.commentsFailed ? 'failed'
        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? 'not_read'
            : (ch.commentsLoaded ? 'read' : 'partial'));""",
     'cmtface')

# ③ 属性计数不重复
edit("""        const allowed = PIXIV_ALLOWED_ATTRS[name];
        let kept = '';
        if (allowed && allowed.length) {
            for (const an of allowed) {
                const re = new RegExp(an + '\\\\s*=\\\\s*([\\'"]?)([^\\'">\\\\s]*)\\\\1', 'i');
                const am = attrText.match(re);
                if (!am) continue;
                const val = am[2];
                // 只认折折叠钩子这一种值；其余值算「属性在但值不合规」，照样计数
                if (an === 'class' && val !== 'tl') { droppedAttrs += 1; continue; }
                kept += ' ' + an + '="' + val + '"';
            }
            if (!kept && attrText.trim()) droppedAttrs += 1;
        } else if (attrText.trim()) {
            droppedAttrs += 1;
        }""",
     """        const allowed = PIXIV_ALLOWED_ATTRS[name];
        let kept = '';
        let handled = false;   // ★ 同一个属性不许进两个格子：兜底只在「一个都没处理过」时触发
        if (attrText.trim()) {
            if (allowed && allowed.length) {
                for (const an of allowed) {
                    handled = true;
                    const re = new RegExp(an + '\\\\s*=\\\\s*([\\'"]?)([^\\'">\\\\s]*)\\\\1', 'i');
                    const am = attrText.match(re);
                    if (!am) continue;
                    const val = am[2];
                    // 只认折叠钩子这一种值；其余值算「属性在但值不合规」
                    if (an === 'class' && val !== 'tl') { droppedAttrs += 1; continue; }
                    kept += ' ' + an + '="' + val + '"';
                }
            }
            if (!handled) droppedAttrs += 1;
        }""",
     'attrs')

text = io.open(PATH, encoding='utf-8').read()
for old, new, label in EDITS:
    n = text.count(old)
    if n != 1:
        print('FAIL %s: 锚点命中 %d 次' % (label, n))
        sys.exit(1)
    text = text.replace(old, new)
io.open(PATH, 'w', encoding='utf-8').write(text)
print('全部完成')