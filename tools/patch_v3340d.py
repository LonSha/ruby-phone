# -*- coding: utf-8 -*-
"""[v3.34.0] 第四批：I10 的破坏面与判据面**不是同一行**。

现场：DAMAGE a2 破坏的是 `expired: pr.expired, firstId:`（ingestBatch 的返回语句），
而 `appCountProblems` 判的是裸 `expired: pr.expired` —— 这个子串在 App 里**另有一处**
（`createCollection` 的 `return { ok: true, id: col.id, expired: pr.expired };`）⇒ 破坏后
判据仍看得到它，「没报」（假绿）。

修法：破坏改成**删字段**（`expired: pr.expired, ` → ``），判据改成**按返回语句裁段**再判
`expired` 在不在段内 —— 判据看的是「入口有没有如实回报裁剪」这条契约，锚在返回语句的形状上
（`return { ok: true, parsed:` 起首），**不引用破坏用的那串字面量**（H5 判据纯度）。
"""
import io
import sys

TESTS = 'tests/system-v3340.test.mjs'

EDITS = [
    (TESTS,
     """    /* ⑩ App：越界块不再如实计数（parsed 恒等于收下的条数） */
    a2: [LF_APP, 'expired: pr.expired, firstId:', 'expired: 0, firstId:'],""",
     """    /* ⑩ App：收下批次时**不再如实回报裁剪**（`expired` 字段整块消失）
     *  ★ 破坏面必须与判据面**在同一行**：`expired: pr.expired` 这个子串在 App 里另有一处
     *    （createCollection 的返回），只改数值判据看不见 ⇒ 假绿。故这里改成删字段。 */
    a2: [LF_APP, 'expired: pr.expired, firstId:', 'firstId:'],""",
     'tests DAMAGE a2: 改成删 expired 字段'),

    (TESTS,
     """const appCountProblems = (src) => {
    const bad = [];
    if (!src.includes('expired: pr.expired')) bad.push('ingest-expired-not-reported');
    if (src.includes('void LOFTER_REASONS')) bad.push('fake-consume-void');
    if (src.includes('    counts()')) bad.push('dead-method-counts');
    return bad;
};""",
     """const appCountProblems = (src) => {
    const bad = [];
    /* 「收下批次」这条入口必须**如实回报裁剪条数**：判据按返回语句裁段再看字段在不在
     * （不引用破坏串 —— 判据纯度：负控制层里的锚点字面量只准声明一次）。 */
    const m = src.match(/return \\{ ok: true, parsed:[\\s\\S]{0,220}?\\};/);
    if (!m) bad.push('ingest-return-missing');
    else if (!m[0].includes('expired')) bad.push('ingest-expired-not-reported');
    if (src.includes('void LOFTER_REASONS')) bad.push('fake-consume-void');
    if (src.includes('    counts()')) bad.push('dead-method-counts');
    return bad;
};""",
     'tests appCountProblems: 按返回语句裁段判 expired'),
]


def edit(path, old, new, label):
    with io.open(path, encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != 1:
        print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
        sys.exit(1)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(text.replace(old, new, 1))
    print('OK   %s' % label)


for path, old, new, label in EDITS:
    edit(path, old, new, label)
print('全部完成')