#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.01.0] 修正内核自检：曲目 track 不被 magazine 收，多目标样本改用 wechat+weibo。"""
import io, sys

p = '/home/user/ruby-phone/config/creation-multi-draft.js'
s = io.open(p, encoding='utf-8').read()

A = '/* ───────── ⑦ 自检 ───────── */'
B = '/* ───────── ⑧ 导出清单 ───────── */'
i = s.find(A)
j = s.find(B)
if i < 0 or j < 0 or j < i:
    print('FAIL 段边界未找到')
    sys.exit(1)

NEW = '''/* ───────── ⑦ 自检 ───────── */
export function cmdSelfCheck() {
    const problems = [];
    if (CMD_DRAFT_STATES.length !== 4) problems.push('草稿态应四态，实际 ' + String(CMD_DRAFT_STATES.length));
    /* 多目标样本用 wechat + weibo：两者都收 track（magazine 不收曲目，不能当样本）。 */
    const c = composeDrafts('musicdesk', 't1', ['wechat', 'weibo'], { per: { weibo: { note: '一段剧情' }, wechat: { note: '另一段' } } });
    if (!c.ok || c.drafts.length !== 2) problems.push('两目标编排应得 2 份草稿，实际 ' + String(c.drafts.length));
    const weibo = c.drafts.filter(function (d) { return d.target === 'weibo'; })[0];
    const wchat = c.drafts.filter(function (d) { return d.target === 'wechat'; })[0];
    if (!weibo || weibo.note !== '一段剧情') problems.push('逐目标注释未落到 weibo 那一份');
    if (!wchat || wchat.note !== '另一段') problems.push('逐目标注释未落到 wechat 那一份（两份被覆盖了）');
    if (weibo && wchat && weibo.note === wchat.note) problems.push('两份注释不应相等（说明没分开持）');
    if (weibo && wchat && weibo.key === wchat.key) problems.push('不同目标的草稿键不得相同');
    if (composeDrafts('musicdesk', 't1', ['lofter'], {}).ok) problems.push('曲目→老福特（不收曲目）应被逐目标拒');
    if (!composeDrafts('musicdesk', 't1', ['lofter'], {}).rejected.length) problems.push('被拒目标必须进 rejected（不静默丢）');
    if (composeDrafts('musicdesk', 't1', [], {}).ok) problems.push('零目标不得当作成功');
    if (composeDrafts('musicdesk', 't1', ['wechat', 'weibo', 'magazine', 'pixiv', 'doujin', 'lofter', 'weibo'], {}).reason.indexOf('too-many') !== 0) problems.push('超上限应拒（去重后 6 个含 lofter 仍不超；7 个才超）');
    /* 替图不丢文字 */
    const sw = replaceMaterialKeepText(weibo, 'musicdesk', 't9');
    if (!sw.ok || sw.draft.note !== '一段剧情') problems.push('替图不得丢掉注释');
    if (sw.ok && sw.draft.state !== 'stale') problems.push('换过素材的草稿必须置 stale（不得假装 ready）');
    if (sw.ok && sw.draft.tags.join() !== weibo.tags.join()) problems.push('替图不得丢掉话题标签');
    if (sw.ok && sw.draft.version !== weibo.version + 1) problems.push('替图应把版本号 +1');
    if (replaceMaterialKeepText(weibo, '', 'x').ok) problems.push('缺素材不得当作替图成功');
    /* 版本比较 */
    const same = diffDrafts(weibo, weibo);
    if (same.reason !== 'identical' || same.fields.length) problems.push('同一份草稿自比必须 identical 且零字段');
    const df = diffDrafts(wchat, Object.assign({}, wchat, { note: '改过的正文' }));
    if (!df.comparable || df.fields.length !== 1 || df.fields[0].field !== 'note') problems.push('改正文应只报 note 一处不同');
    if (diffLine(df).indexOf('1 处不同') !== 0) problems.push('diffLine 应如实报处数');
    if (diffDrafts(weibo, wchat).reason !== 'key-changed') problems.push('不同键的两份必须报键变（不得当同一份比）');
    /* 仅重做所选段 */
    const book = c.drafts;
    const rc = recomposeTargets(book, ['weibo'], 'musicdesk', 't2', {});
    if (rc.kept !== 1) problems.push('只重做 1 个目标时应保留 1 份，实际 ' + String(rc.kept));
    if (rc.drafts.length !== 2) problems.push('重做后总数应仍为 2，实际 ' + String(rc.drafts.length));
    const keptW = rc.drafts.filter(function (d) { return d.target === 'wechat'; })[0];
    if (!keptW || keptW.note !== '另一段') problems.push('未选中的目标必须原样保留其编辑');
    const redoneW = rc.drafts.filter(function (d) { return d.target === 'weibo'; })[0];
    if (!redoneW || redoneW.note !== '一段剧情') problems.push('重做的目标必须继承旧那份的文字（只重做 = 换素材，不是丢文字）');
    /* 草稿本：读不出与空分得开 */
    if (normalizeDraftBook(null).readable !== false) problems.push('读不出必须 readable:false');
    if (normalizeDraftBook('x').readable !== false) problems.push('非数组必须 readable:false');
    if (normalizeDraftBook([]).readable !== true) problems.push('空数组必须 readable:true（与读不出是两件事）');
    if (normalizeDraftBook([{ key: 'x' }, null]).dropped !== 2) problems.push('认不出的行应如实计数');
    if (normalizeDraft({}).ok) problems.push('缺键的草稿必须被窄口拒');
    if (normalizeDraft({ key: 'k', source: 's', target: 't', state: 'zzz' }).ok) problems.push('非法态必须被拒');
    /* 文案预览不编内容 */
    const pv = previewOf(weibo, { label: '曲目甲', kindLabel: '曲目', present: true });
    if (pv.readyToPublish !== true) problems.push('有正文且在场的素材应可发');
    const pvEmpty = previewOf(normalizeDraft({ key: 'k', source: 'musicdesk', target: 'wechat' }).draft, { label: '曲目甲' });
    if (pvEmpty.readyToPublish !== false) problems.push('没写正文不得报可发');
    if (/已发布/.test(pv.title + pv.body + pv.tagLine)) problems.push('文案不得出现「已发布」这类无凭据说法');
    /* 幂等：同一键 upsert 两次只留一份（后到覆盖） */
    const up1 = upsertDraft([], weibo);
    const up2 = upsertDraft(up1.drafts, Object.assign({}, weibo, { note: '改过的正文' }));
    if (up2.drafts.length !== 1) problems.push('同键 upsert 两次应只留一份，实际 ' + String(up2.drafts.length));
    if (up2.drafts[0].note !== '改过的正文') problems.push('upsert 必须后到覆盖先到');
    if (upsertDraft([], null).changed !== false) problems.push('非法草稿 upsert 不得改草稿本');
    return { ok: problems.length === 0, problems: problems, limits: CMD_LIMITS.drafts, states: CMD_DRAFT_STATES.length };
}

'''

s = s[:i] + NEW + s[j:]
io.open(p, 'w', encoding='utf-8').write(s)
print('OK selfcheck replaced')
