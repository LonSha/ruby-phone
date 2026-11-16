/**
 * 无障碍可达性读数 —— 唯一桥（v4.157.0 · R22-O3）
 *
 * 纪律：纯函数，吃「页面描述」吐「可达性缺口清单与计数」，不碰真 DOM。
 * 页面描述由调用方（诊断/测试）提供：{ nodes: [{ tag, hasLabel, hasRole, tabIndex, clickable }] }。
 * 交互元素（button/input/a/clickable）缺 aria-label / role / tabindex 各计缺一项。
 */
const A11Y_FACES = Object.freeze(['empty', 'pass', 'gaps']);

export function a11yAudit(pageDesc) {
    const nodes = pageDesc && Array.isArray(pageDesc.nodes) ? pageDesc.nodes.filter((n) => n && typeof n === 'object') : [];
    if (nodes.length === 0) return { face: 'empty', interactive: 0, gaps: [], gapCount: 0 };
    const INTERACTIVE = new Set(['button', 'input', 'a', 'select', 'textarea']);
    const gaps = [];
    let interactive = 0;
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const tag = String(n.tag == null ? '' : n.tag).toLowerCase();
        const isInteractive = INTERACTIVE.has(tag) || n.clickable === true;
        if (!isInteractive) continue;
        interactive++;
        if (!n.hasLabel) gaps.push({ index: i, tag, missing: 'aria-label' });
        if (!n.hasRole) gaps.push({ index: i, tag, missing: 'role' });
        if (n.tabIndex == null || Number(n.tabIndex) < 0) gaps.push({ index: i, tag, missing: 'tabindex' });
    }
    return { face: gaps.length ? 'gaps' : 'pass', interactive, gaps, gapCount: gaps.length };
}

export function a11yNote(r) {
    const face = r && r.face;
    if (face === 'empty') return '没有可检查的元素';
    if (face === 'pass') return `${r.interactive} 个交互元素都可达`;
    return `${r.gapCount} 处无障碍缺口`;
}

export function a11ySelfCheck() {
    const bad = [];
    if (a11yAudit({ nodes: [] }).face !== 'empty') bad.push('空应 empty');
    const good = a11yAudit({ nodes: [{ tag: 'button', hasLabel: true, hasRole: true, tabIndex: 0 }] });
    if (good.face !== 'pass') bad.push('全可达应 pass');
    const bad1 = a11yAudit({ nodes: [{ tag: 'button', hasLabel: false, hasRole: false, tabIndex: -1 }] });
    if (bad1.face !== 'gaps' || bad1.gapCount !== 3) bad.push('三缺应计 3，得 ' + bad1.gapCount);
    const nonInteractive = a11yAudit({ nodes: [{ tag: 'div', hasLabel: false }] });
    if (nonInteractive.face !== 'pass') bad.push('非交互元素不计缺');
    return { ok: bad.length === 0, bad };
}
