# -*- coding: utf-8 -*-
"""[v3.34.0] 给 lofter-data.js 补「文风库」的收口。

源的文风库在 `_defaultLofterData().settings.writingStyles`（11 款内置 + 用户可增删改），
`_ensureWritingStyleDefaults()` 负责把内置的补进来、`_styleInstructionFor()` 把 rules 拼进 prompt。
数据层已有 `LOFTER_WRITING_STYLES`（11 款），但 **`normalizeLofterSettings` 没有收它的口** ——
设置面回写一次就会把文风库整块丢掉（`normalizeLofterSettings` 返回对象里没有这个键）。

本补丁做两件事：
  ① 新增导出 `normalizeWritingStyles(raw)`：逐款收口（`id` / `name` 必须有，`rules` 收成字符串，
     `enabled` 只认显式 false），并把**内置缺项补回**（源 `_ensureWritingStyleDefaults` 的收口）；
  ② 把它挂进 `defaultLofterSettings` / `normalizeLofterSettings` 两处返回对象。

替换按**多行锚点原文**做，命中次数必须恰好 1，否则脚本失败（防重复执行 / 锚点漂移）。
"""
import ast
import sys

PATH = 'apps/lofter/lofter-data.js'

A_OLD = """export function defaultLofterSettings() {
    return {
        defaultViewMode: 'grid',
        chapterLength: 'medium',
        autoGenCount: 2,
        showInvalidArticles: true,
    };
}"""

A_NEW = """/**
 * 文风库收口（源 `_ensureWritingStyleDefaults` 的收口）：
 *   · 用户自己的文风**保住**（id 与 name 都在就留）；
 *   · 内置 11 款**缺哪款补哪款**（源逐款查缺补漏）；
 *   · `enabled` 只认**显式 false**（缺键 = 启用，与源 `!== false` 同口径）。
 * 返回新数组，**不原地改**。
 */
export function normalizeWritingStyles(raw) {
    const src = (Array.isArray(raw) ? raw : []).filter((s) => s && typeof s === 'object');
    const out = [];
    const seen = new Set();
    for (const s of src) {
        const id = String(s.id || '').trim();
        const name = String(s.name || '').trim();
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            name,
            description: String(s.description || '').trim(),
            rules: String(s.rules || '').trim(),
            enabled: s.enabled === false ? false : true,
            builtIn: s.builtIn === true,
        });
    }
    for (const b of LOFTER_WRITING_STYLES) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        out.push({
            id: b.id, name: b.name, description: b.description,
            rules: b.rules, enabled: b.enabled === false ? false : true, builtIn: true,
        });
    }
    return out;
}

export function defaultLofterSettings() {
    return {
        defaultViewMode: 'grid',
        chapterLength: 'medium',
        autoGenCount: 2,
        showInvalidArticles: true,
        writingStyles: normalizeWritingStyles(LOFTER_WRITING_STYLES),
    };
}"""

B_OLD = """    return {
        defaultViewMode: mode,
        chapterLength: len,
        autoGenCount: count,
        showInvalidArticles: src.showInvalidArticles === false ? false : true,
    };
}"""

B_NEW = """    return {
        defaultViewMode: mode,
        chapterLength: len,
        autoGenCount: count,
        showInvalidArticles: src.showInvalidArticles === false ? false : true,
        // 文风库：**坏值不许回默认**（回默认 = 用户自己加的文风被静默抹掉），
        // 缺键才补内置。`normalizeWritingStyles(null)` 会得到完整 11 款内置。
        writingStyles: normalizeWritingStyles(src.writingStyles),
    };
}"""


def patch(text: str, old: str, new: str, tag: str) -> str:
    n = text.count(old)
    if n != 1:
        print('FAIL[%s]: 锚点命中 %d 次（必须恰好 1 次）' % (tag, n))
        sys.exit(1)
    return text.replace(old, new, 1)


def main() -> int:
    with open(PATH, encoding='utf-8') as f:
        text = f.read()
    text = patch(text, A_OLD, A_NEW, 'A')
    text = patch(text, B_OLD, B_NEW, 'B')
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(text)
    print('两处锚点各命中 1 次，已改写。')
    return 0


if __name__ == '__main__':
    sys.exit(main())