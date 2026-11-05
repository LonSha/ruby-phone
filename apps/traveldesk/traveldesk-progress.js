/* In-progress operations preserve route history and never infer transport time. */
export function progressAction(party, action) {
    const next = structuredClone(party);
    const stop = next.stops.find(s => s.id === action.id);
    if (!stop || next.stops.filter(s => s.id === action.id).length !== 1) return { ok: false, note: '站点已失效或身份重复，请刷新' };
    if (!['current', 'skip', 'late', 'meet', 'reschedule'].includes(action.op)) return { ok: false, note: '未知行程操作' };
    if (action.op === 'reschedule' && (typeof action.day !== 'string' || /^\d{4}-\d{2}-\d{2}$/.test(action.day) === false || Number.isFinite(Date.parse(action.day + 'T00:00:00Z')) === false || new Date(action.day + 'T00:00:00Z').toISOString().slice(0, 10) !== action.day)) return { ok: false, note: '请输入有效日期 YYYY-MM-DD' };
    if (action.op === 'late' && (!Number.isSafeInteger(action.minutes) || action.minutes < 1 || action.minutes > 1440)) return { ok: false, note: '请输入 1–1440 分钟的晚到时间' };
    if (action.op === 'meet' && (typeof action.person !== 'string' || !action.person.trim() || action.person.length > 80)) return { ok: false, note: '请填写会合对象' };
    if (stop.progress === 'skipped' && action.op !== 'skip') return { ok: false, note: '该站已跳过，历史保留' };
    if (action.op === 'current') {
        for (const s of next.stops) if (s.progress === 'current' && s.id !== stop.id) s.progress = 'visited';
        stop.progress = 'current';
    } else if (action.op === 'skip') stop.progress = 'skipped';
    else if (action.op === 'late') stop.lateMinutes = action.minutes;
    else if (action.op === 'meet') stop.meetWith = action.person.trim();
    else stop.day = action.day;
    const affected = next.stops.slice(next.stops.indexOf(stop) + 1).filter(s => s.progress !== 'skipped').map(s => ({ id: s.id, place: s.place, day: s.day }));
    return { ok: true, party: next, affected, note: '更新「' + stop.place + '」；后续 ' + affected.length + ' 站需复核。交通耗时未知，原日程与费用保留。' };
}
