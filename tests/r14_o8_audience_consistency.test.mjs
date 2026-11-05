// tests/r14_o8_audience_consistency.test.mjs — 第十四期 R14-O8「朋友圈发布前后同一份可见规则」
//
// 计划书原文：
//   本期交付：先核对并收敛实际发送与读取规则，再补已发内容的逐人结果；
//             不让预览和实际两套算法分叉。
//   验收旅程：公开/指定可见/屏蔽三类规则及id同名边界逐项对拍；
//             编辑规则刷新结果，读不出明确降级不装成已验证。
//
// 本套件守四件事：
//   · A 对拍：发布预览内核(projectAudienceForContact) vs 真源(canContactViewMoment)
//     在 公开/仅给谁看/不给谁看 三类规则 + id同名边界 上逐人必须同结论。
//   · B 编辑刷新：updateMomentVisibility 真写回 + 读取口径立变（对拍同款规则再对拍）。
//   · C 接线：已发详情入口(audience-btn/showMomentAudienceDetail/编辑规则回写)在视图里在位。
//   · D 负控制：破坏真源 canContactViewMoment 的 exclude 分支 ⇒ 对拍必转红；
//     破坏 updateMomentVisibility 的写回 ⇒ B 判据必转红。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WD_REL = 'apps/wechat/wechat-data.js';
const VIEW_REL = 'apps/wechat/moments-view.js';
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const temps = [];
process.on('exit', () => { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} } });
function makeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    const st = {
        get(key, def = null) { return map.has(key) ? map.get(key) : def; },
        set(key, value) { map.set(key, value); return true; },
        remove(key) { map.delete(key); return true; }
    };
    return st;
}
async function loadMod(root) {
    const { WechatData } = await import(pathToFileURL(path.join(root, WD_REL)).href);
    return { WechatData };
}
/* 名册含 id 同名边界：c2 与 c3 同名但不同 id —— 命中次序不同结论就必须不同。 */
const ROSTER = [
    { id: 'id-a', name: 'Alpha' },
    { id: 'id-b', name: 'Beta' },
    { id: 'id-c', name: 'Beta' }
];
const RULES = {
    public: { type: 'public', contactIds: [], contactNames: [] },
    include: { type: 'include', contactIds: ['id-b'], contactNames: [] },
    exclude: { type: 'exclude', contactIds: ['id-b'], contactNames: [] }
};
/* A：预览内核 vs 真源，逐规则逐人对拍。 */
async function judgeParity(root) {
    const { WechatData } = await loadMod(root);
    const { projectAudienceForContact } = await import(pathToFileURL(path.join(root, 'config/audience-projection.js')).href);
    const wd = new WechatData(makeStorage());
    wd.data.contacts = ROSTER.slice();
    const diffs = [];
    for (const [ruleName, rule] of Object.entries(RULES)) {
        const moment = { id: 'm1', name: 'user', text: 'x', visibility: rule };
        for (const contact of ROSTER) {
            const real = wd.canContactViewMoment(moment, contact);
            const preview = projectAudienceForContact({ audienceRules: rule, contact }).visible;
            if (real !== preview) diffs.push(ruleName + ':' + contact.id);
        }
    }
    return { diffs };
}
/* B：编辑规则真写回，读取口径立变。 */
async function judgeEditRefresh(root) {
    const { WechatData } = await loadMod(root);
    const st = makeStorage();
    const wd = new WechatData(st);
    wd.data.contacts = ROSTER.slice();
    wd.data.moments = [{ id: 'm1', name: 'user', text: 'x' }];
    const before = ROSTER.map(c => wd.canContactViewMoment(wd.data.moments[0], c));
    const r = wd.updateMomentVisibility('m1', { type: 'hidden', contactIds: ['id-a'], contactNames: [] });
    const after = ROSTER.map(c => wd.canContactViewMoment(wd.data.moments[0], c));
    const again = wd.updateMomentVisibility('m1', { type: 'only', contactIds: ['id-b'], contactNames: [] });
    const third = ROSTER.map(c => wd.canContactViewMoment(wd.data.moments[0], c));
    const missing = wd.updateMomentVisibility('nope', { type: 'public' });
    return {
        r, again, missing,
        beforeAllVisible: before.every(Boolean),
        afterAHidden: after[0] === false,
        afterBOthersVisible: after[1] === true && after[2] === true,
        thirdOnlyB: third[1] === true && third[0] === false && third[2] === false
    };
}
test('A 预览内核与真源逐人对拍一致(公开/仅给谁看/不给谁看 + id同名边界)', async () => {
    const { diffs } = await judgeParity(ROOT);
    assert.deepEqual(diffs, [], '预览与实际不许分叉，分歧点: ' + diffs.join(', '));
});
test('B1 编辑规则真写回且读取口径立变(别名归一 hidden→exclude, only→include)', async () => {
    const j = await judgeEditRefresh(ROOT);
    assert.equal(j.r.ok, true);
    assert.equal(j.beforeAllVisible, true, '初始无规则=公开');
    assert.equal(j.afterAHidden, true, 'hidden 别名应收敛为 exclude:id-a 被屏蔽');
    assert.equal(j.afterBOthersVisible, true, '名单外的人不受 exclude 影响');
    assert.equal(j.thirdOnlyB, true, 'only 别名应收敛为 include:仅 id-b 可见(同名 c3 不可见,走 id 命中)');
    assert.equal(j.again.ok, true);
});
test('B2 不存在的动态必须如实拒绝(不装成成功)', async () => {
    const j = await judgeEditRefresh(ROOT);
    assert.equal(j.missing.ok, false);
    assert.equal(j.missing.reason, 'not-found');
});
test('C 视图接线:已发详情入口 + 编辑规则回写在位', () => {
    const view = readRel(VIEW_REL);
    assert.ok(view.includes('audience-btn'), '操作弹窗里有「谁能看到」入口');
    assert.ok(view.includes('_isOwnMoment(moment)'), '入口只对本人的动态出现');
    assert.ok(view.includes('showMomentAudienceDetail(momentId)'), '已发详情弹层存在');
    assert.ok(view.includes('canContactViewMoment(moment, contact)'), '详情逐人结论必须消费真源(不许另算一套)');
    assert.ok(view.includes('showMomentVisibilityPickerForMoment(momentId)'), '编辑规则入口存在');
    assert.ok(view.includes('updateMomentVisibility(momentId, this.pendingMomentVisibility)'), '确认时写回真源');
});
/* D 负控制：真源码破坏 → 落副本 → 副本上重跑同款判据必须转红。 */
/* 副本树：从入口递归解析相对 import 复制整条闭包（同 r14_o6 的 mkTree 思路，
 *   手写清单会漏 config 依赖 ⇒ ERR_MODULE_NOT_FOUND ⇒ 负控制因缺文件误红）。 */
function closureOf(entry) {
    const seen = new Set();
    const stack = [entry];
    while (stack.length) {
        const rel = stack.pop();
        if (seen.has(rel)) continue;
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) continue;
        seen.add(rel);
        const src = fs.readFileSync(abs, 'utf8');
        const re = /from\s+['"](\.[^'"]+)['"]/g;
        let m;
        while ((m = re.exec(src))) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
            stack.push(target);
        }
    }
    return Array.from(seen);
}
function damageCopy(from, to) {
    const src = readRel(WD_REL);
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必须恰中一次: ' + n);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_o8_'));
    temps.push(dir);
    for (const rel of closureOf(WD_REL)) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    fs.copyFileSync(path.join(ROOT, 'config/audience-projection.js'), path.join(dir, 'config/audience-projection.js'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    fs.writeFileSync(path.join(dir, WD_REL), src.split(from).join(to), 'utf8');
    return dir;
}
test('D1 ★ 破坏真源 exclude 分支(结论取反) ⇒ 对拍必转红', async () => {
    const dir = damageCopy(
        "return visibility.type === 'include' ? isSelected : !isSelected;",
        "return visibility.type === 'include' ? isSelected : isSelected;"
    );
    const { diffs } = await judgeParity(dir);
    assert.ok(diffs.length > 0, '真源被破坏后预览/实际必须分叉(否则对拍判据是假的)');
});
test('D2 ★ 破坏 updateMomentVisibility 写回(不写 moment.visibility) ⇒ B1 必转红', async () => {
    const dir = damageCopy(
        "moment.visibility = {\n            type: normalized.type,",
        "moment.visibilityZzz = {\n            type: normalized.type,"
    );
    const j = await judgeEditRefresh(dir);
    assert.equal(j.afterAHidden, false, '写回被破坏后 exclude 必须失效(B 判据必须能看见)');
});
