/**
 * 零测试目录报告 —— 唯一桥（v4.157.0 · R22-O6）
 *
 * 纪律：纯函数。吃「目录 → { 文件数, 有测试文件数 }」，吐零测试目录清单与覆盖率形状。
 * 只报事实，不补测试、不设绝对下限。四态：invalid / allCovered / hasGaps。
 */
export const COVERAGE_FACES = Object.freeze(['invalid', 'allCovered', 'hasGaps']);

export function coverageReport(dirs) {
    if (!dirs || typeof dirs !== 'object') return { face: 'invalid', zeroDirs: [], total: 0 };
    const zeroDirs = [];
    let total = 0;
    for (const name of Object.keys(dirs)) {
        const d = dirs[name];
        if (!d || typeof d !== 'object') continue;
        total++;
        const files = Number(d.files) || 0;
        const tested = Number(d.tested) || 0;
        if (files > 0 && tested === 0) zeroDirs.push({ name, files });
    }
    zeroDirs.sort((a, b) => a.name.localeCompare(b.name));
    return { face: zeroDirs.length ? 'hasGaps' : 'allCovered', zeroDirs, total };
}

export function coverageNote(r) {
    if (!r || r.face === 'invalid') return '覆盖率读数读不出来';
    if (r.face === 'allCovered') return `${r.total} 个目录都有测试`;
    return `${r.zeroDirs.length} 个目录一行测试都没有：${r.zeroDirs.map((d) => d.name).join('、')}`;
}

export function coverageSelfCheck() {
    const bad = [];
    if (coverageReport(null).face !== 'invalid') bad.push('空应 invalid');
    if (coverageReport({ a: { files: 3, tested: 3 } }).face !== 'allCovered') bad.push('全覆盖应 allCovered');
    const r = coverageReport({ a: { files: 3, tested: 0 }, b: { files: 2, tested: 2 }, c: { files: 1, tested: 0 } });
    if (r.face !== 'hasGaps') bad.push('有缺口应 hasGaps');
    if (r.zeroDirs.length !== 2) bad.push('零测试目录数错，得 ' + r.zeroDirs.length);
    if (r.zeroDirs[0].name !== 'a') bad.push('应排序');
    return { ok: bad.length === 0, bad };
}
