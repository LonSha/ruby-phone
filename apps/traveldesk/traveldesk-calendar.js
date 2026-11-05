/** Explicit calendar owner handoff. Never infer a link from a title. */
export function travelCalendarPreview(party, stopId, memoId, calendar) {
    const stop = party.stops.find(s => s.id === stopId);
    if (!stop || party.stops.filter(s => s.id === stopId).length !== 1 || stop.progress === 'skipped') return { ok: false, note: '站点失效或已跳过' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stop.day) || !Number.isFinite(Date.parse(stop.day + 'T00:00:00Z')) || new Date(stop.day + 'T00:00:00Z').toISOString().slice(0, 10) !== stop.day) return { ok: false, note: '请先确认该站的有效日期' };
    if (!calendar || typeof calendar.getMemos !== 'function' || typeof calendar.updateMemo !== 'function') return { ok: false, note: '请先打开日历，再返回旅行页接续' };
    const matches = calendar.getMemos().filter(m => m.id === memoId);
    if (matches.length !== 1) return { ok: false, note: '关联日程已失效或身份重复' };
    const memo = matches[0];
    if (memo.source === 'commitment' || memo.sourceId || memo.commitmentSourceId || calendar.isRecurringType?.(memo.type)) return { ok: false, note: '该日程由约定或周期规则管理，请在原入口改期' };
    return { ok: true, stopId, memoId, day: stop.day, expectedParty: JSON.stringify(party), expectedMemo: JSON.stringify(memo), note: '将「' + memo.title + '」从 ' + memo.dateKey + ' 改为 ' + stop.day + '，保留原时间 ' + (memo.time || '未设置') + '。仅更新这一条日程。' };
}
export function commitTravelCalendar(party, preview, calendar) {
    if (!preview || typeof preview !== 'object') return { ok: false, note: '缺少确认预览' };
    const fresh = travelCalendarPreview(party, preview.stopId, preview.memoId, calendar);
    if (!fresh.ok) return fresh;
    if (fresh.expectedParty !== preview.expectedParty || fresh.expectedMemo !== preview.expectedMemo || fresh.day !== preview.day) return { ok: false, note: '行程或日程已变化，请重新预览' };
    try {
        const stored = calendar.storage?.get?.(calendar.memoKey);
        const storedRows = typeof stored === 'string' ? JSON.parse(stored) : stored;
        if (!Array.isArray(storedRows) || storedRows.filter(m => m.id === fresh.memoId).length !== 1) return { ok: false, note: '日历来源无法确认，请刷新日历' };
        const storedMemo = storedRows.find(m => m.id === fresh.memoId);
        if (JSON.stringify(storedMemo) !== fresh.expectedMemo) return { ok: false, note: '日历缓存与保存记录不一致，请刷新后重新预览' };
        if (JSON.stringify(storedRows) !== JSON.stringify(calendar.getMemos())) return { ok: false, note: '日历列表已变化，请刷新后重新预览' };
        if (storedMemo.dateKey === fresh.day) return { ok: true, note: '日程已是该日期，无需重复更新' };
        if (calendar.updateMemo(fresh.memoId, { dateKey: fresh.day }) !== true) return { ok: false, note: '日历未接受改期' };
        const raw = calendar.storage?.get?.(calendar.memoKey);
        const rows = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(rows) || rows.filter(m => m.id === fresh.memoId && m.dateKey === fresh.day).length !== 1) return { ok: false, note: '日历保存未确认，请打开日历核对后重试' };
        return { ok: true, note: '关联日程已接续，原时间保留' };
    } catch (_) { return { ok: false, note: '日历接续失败，请核对原日程' }; }
}
