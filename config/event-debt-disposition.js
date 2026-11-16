/**
 * 事件订阅欠账处置 —— 唯一桥（v4.157.0 · R22-O7）
 *
 * 纪律：纯函数。把「emit>0 且 on===0」的事件逐条定性：接订阅 / 对外遥测 / 跨仓转交。
 * 两路互斥：进 debt 必须有据，不进 debt 要么有订阅要么双向零使用。不许挂一个理由了事。
 * 四态：invalid / clean / debt。
 */
export const EVENT_DISPOSITIONS = Object.freeze(['subscribe', 'telemetry', 'cross-repo']);
const EVENT_FACES = Object.freeze(['invalid', 'clean', 'debt']);

export function disposeEvents(events) {
    if (!Array.isArray(events)) return { face: 'invalid', debt: [], clean: [] };
    const debt = [];
    const clean = [];
    for (const e of events) {
        if (!e || typeof e !== 'object') continue;
        const name = String(e.name == null ? '' : e.name);
        const emit = Number(e.emit) || 0;
        const on = Number(e.on) || 0;
        if (emit > 0 && on === 0) {
            const disp = String(e.disposition == null ? '' : e.disposition);
            if (EVENT_DISPOSITIONS.includes(disp) && String(e.why || '').length >= 8) {
                clean.push({ name, disposition: disp, why: String(e.why) });
            } else {
                debt.push({ name, emit, why: 'unexplained' });
            }
        } else {
            clean.push({ name, disposition: on > 0 ? 'subscribed' : 'unused' });
        }
    }
    return { face: debt.length ? 'debt' : 'clean', debt, clean };
}

function eventDebtNote(r) {
    if (!r || r.face === 'invalid') return '事件读数读不出来';
    if (r.face === 'clean') return '没有无据的事件欠账';
    return `${r.debt.length} 条事件派发无订阅且无据：${r.debt.map((d) => d.name).join('、')}`;
}

export function eventDebtSelfCheck() {
    const bad = [];
    if (disposeEvents(null).face !== 'invalid') bad.push('非数组应 invalid');
    if (disposeEvents([]).face !== 'clean') bad.push('空应 clean');
    const clean = disposeEvents([{ name: 'a', emit: 1, on: 2 }, { name: 'b', emit: 1, on: 0, disposition: 'telemetry', why: '对外遥测读数，宿主不订阅' }]);
    if (clean.face !== 'clean') bad.push('有订阅/有据应 clean');
    const debt = disposeEvents([{ name: 'c', emit: 1, on: 0 }, { name: 'd', emit: 1, on: 0, disposition: 'telemetry', why: '短' }]);
    if (debt.face !== 'debt') bad.push('无据应 debt');
    if (debt.debt.length !== 2) bad.push('欠账数错，得 ' + debt.debt.length);
    return { ok: bad.length === 0, bad };
}
