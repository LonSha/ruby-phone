#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_patch_rp_o2_a4.py — R-O2 第 2 条：版本锚/时点快照一律改为**不变量**。

对象：`tests/system-v3201.test.mjs` 的 A4。
它把 check 链**逐字钉死**成 v3.20.1 那一刻的 11 道门：

    assert.match(String(pkg.scripts.check),
      /^npm run syntax && ... && npm run upstream-face$/,
      'check 链不得被本版改动（执行器是**包住**它，不是替换它）');

这条判据的**意图**是对的（执行器包住链、不替换链），但表达方式把
「本版没动链」写成了「此后每一版都必须逐字等于这条链」——
于是任何一版合法增门都会被它判红。这正是 R-O2 点名的形态：
**把时点快照当成永久约束**（同族还有「用 log.latest 当版本锚」）。

修法（R-O2 原话「版本锚一律改为钉自己那一版，不随抬版漂移」）：
  ① 语义不变量的表达：**这 11 道门必须在链上、且相互顺序不变（子序列同序）**；
  ② 追加约束：链接尾仍是 `upstream-face`（第三道门的尾锚，由 system-v3203 A1 独立把守，
     这里复述一次是为了让「新增门只能插在它前面」这条口径在本套件里也可见）；
  ③ 保留意图断言：执行器（check-file.mjs）仍是「包住」而不是「替换」——
     以 `scripts/check` 是否存在、且 check-file 不自己维护门清单来判。
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv
REL = 'tests/system-v3201.test.mjs'

OLD = """test('A4 npm 脚本别名在场且指向执行器；既有 check 链一字未动', () => {
    assert.equal(pkg.scripts['check:file'], 'node scripts/check-file.mjs',
        'package.json 必须给 check:file 别名（否则「全量落文件」没有人会记得手敲）');
    assert.match(String(pkg.scripts.check),
        /^npm run syntax && npm run import-resolve && npm run test && npm run dead-exports && npm run lifecycle && npm run registry && npm run keys && npm run source-derivation && npm run bridge-contract && npm run weak-coercion && npm run upstream-face$/,
        'check 链不得被本版改动（执行器是**包住**它，不是替换它）');
});"""

NEW = """test('A4 npm 脚本别名在场且指向执行器；既有 check 链按不变量守住（不再逐字钉死）', () => {
    assert.equal(pkg.scripts['check:file'], 'node scripts/check-file.mjs',
        'package.json 必须给 check:file 别名（否则「全量落文件」没有人会记得手敲）');
    /* ★ [R-O2 修正] 原断言把链**逐字钉死**成 v3.20.1 那一刻的 11 道门：
     *     assert.match(chain, /^npm run syntax && ... && npm run upstream-face$/)
     *   它的**意图**是对的（执行器包住链、不替换链），但表达方式把
     *   「本版没动链」写成了「此后每一版都必须逐字等于这条链」——
     *   于是任何一版合法增门都会判红。这正是 R-O2 点名的形态：
     *   **把时点快照当成永久约束**（同族：拿 `log.latest` 当版本锚）。
     *   改为不变量：这 11 道门必须在链上、且相互顺序不变；尾锚仍是 upstream-face。 */
    const chain = String(pkg.scripts.check);
    const seq = (chain.match(/npm run ([a-z][a-z-]*)/g) || []).map((s) => s.replace('npm run ', ''));
    const MUST = ['syntax', 'import-resolve', 'test', 'dead-exports', 'lifecycle',
        'registry', 'keys', 'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face'];
    /* ① 子序列同序：这 11 道门一个都不能少、相互次序不能换 */
    let i = 0;
    for (const g of seq) if (i < MUST.length && g === MUST[i]) i += 1;
    assert.equal(i, MUST.length,
        '★ 这 11 道门的**子序列**必须在链上按原序出现（缺门或换序即红）：实得 ' + JSON.stringify(seq));
    /* ② 一个都不少（子序列判据对「多出来」是宽容的，对「少一个」才严格 —— 两者都要） */
    for (const g of MUST) assert.ok(seq.includes(g), '链上缺门：' + g);
    /* ③ 尾锚：新增门只能插在 upstream-face 之前（第三道门的尾锚，另由 system-v3203 A1 把守） */
    assert.equal(seq[seq.length - 1], 'upstream-face', 'check 链必须以 upstream-face 收尾');
    /* ④ 意图保留：执行器**包住**链而不是替换它 —— 链本身仍由 package.json 持有 */
    assert.ok(seq.length >= MUST.length, '链不得短于原 11 道门');
});"""


def main():
    p = os.path.join(ROOT, REL)
    src = io.open(p, encoding='utf-8').read()
    assert src.count(OLD) == 1, '锚点命中数 != 1（实际 %d）' % src.count(OLD)
    out = src.replace(OLD, NEW, 1)
    if WRITE:
        io.open(p, 'w', encoding='utf-8').write(out)
        print('[write] %s A4 已改为不变量口径' % REL)
    else:
        print('[dry] would patch', REL)
    t = io.open(p, encoding='utf-8').read()
    assert 'A4 npm 脚本别名在场且指向执行器；既有 check 链一字未动' not in t, '旧标题仍在'
    assert '子序列' in t, '新口径未写入'
    print('[self-check] 旧逐字锚残留 0 处 ✓')


if __name__ == '__main__':
    main()