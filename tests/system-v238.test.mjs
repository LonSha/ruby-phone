/* ============================================================
 * RubyPhone v2.38.0 —— 小剧场世界书随机功能接线
 *
 * 本版问题：theater-data.js 文件头注释写「支持酒馆 {{random:...}}、世界书概率抽取」，
 *   rollWorldBookEntries() 纯函数已完整实现（概率过滤 / random 宏解析 / 前 8 条 / 截 1200 字），
 *   buildPrompt() 已预留 draft.rollResult 读取入口——但全库无任何代码写入 draft.rollResult，
 *   rollWorldBookEntries 全库零调用。五个其他 App（日历/日记/扑克/蜂蜜/妄想）
 *   都已接线到同一个 worldbookManager 基建，唯独小剧场漏了。
 *
 * 本版修法：
 *   · TheaterData 新增 async rollWorldBook()（从 manager 取条目 → 调纯函数 → 写入 draft.rollResult）
 *   · TheaterData 新增 clearRollResult()
 *   · TheaterView 新增 th-roll 面板（按钮 / 状态文字 / 清除 / 预览 pre）+ 事件绑定
 *   · theater.css 追加 th-roll 相关样式
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const vnum = (s) => {
    const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(String(s || '').trim());
    return m ? Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3]) : NaN;
};

/* ================================================================
 * A. 数据层：rollWorldBookEntries 纯函数
 * ================================================================ */
const { rollWorldBookEntries, resolveTavernRandom, splitRandomOptions } = await import(
    path.join(root, 'apps/theater/theater-data.js')
);

// A1: 空输入
ok('A1 rollWorldBookEntries([]) → []',
    Array.isArray(rollWorldBookEntries([])) && rollWorldBookEntries([]).length === 0);

// A2: 正常条目全部通过（probability=100）
const entries2 = [
    { content: '条目一内容', comment: '测试', probability: 100 },
    { content: '条目二内容', comment: '测试2', probability: 100 },
];
const r2 = rollWorldBookEntries(entries2, () => 0.5);
ok('A2 probability=100 全部通过', r2.length === 2);
ok('A2b 输出含 【comment】 前缀', r2.every(s => s.startsWith('【')));

// A3: probability=0 被过滤
const entries3 = [
    { content: '必过', comment: 'A', probability: 100 },
    { content: '必不过', comment: 'B', probability: 0 },
];
const r3 = rollWorldBookEntries(entries3, () => 0.5);
ok('A3 probability=0 被过滤', r3.length === 1 && r3[0].includes('必过'));

// A4: {{random:...}} 宏解析
const entries4 = [
    { content: '选择{{random:A, B, C}}', comment: 'R', probability: 100 },
];
const r4 = rollWorldBookEntries(entries4, () => 0.0); // picker→0 选第一个
ok('A4 random 宏解析', r4.length === 1 && r4[0].includes('选择A'));

// A5: 最多 8 条
const entries5 = Array.from({ length: 12 }, (_, i) => ({ content: 'E' + i, comment: 'C' + i, probability: 100 }));
const r5 = rollWorldBookEntries(entries5, () => 0.5);
ok('A5 最多 8 条', r5.length === 8);

// A6: 内容截断 1200 字
const longContent = 'x'.repeat(2000);
const entries6 = [{ content: longContent, comment: 'L', probability: 100 }];
const r6 = rollWorldBookEntries(entries6, () => 0.5);
ok('A6 截断 1200 字', r6.length === 1 && r6[0].length <= '【L】\n'.length + 1200);

// A7: null / 空 content 条目被过滤
const entries7 = [null, { content: '' }, { content: '有效', comment: 'V', probability: 100 }];
const r7 = rollWorldBookEntries(entries7, () => 0.5);
ok('A7 null/空条目过滤', r7.length === 1 && r7[0].includes('有效'));

// A8: 确定性 picker
const entries8 = [{ content: 'x{{random:P, Q}}y', comment: 'D', probability: 100 }];
const r8a = rollWorldBookEntries(entries8, () => 0.0); // 选 P
const r8b = rollWorldBookEntries(entries8, () => 0.99); // 选 Q
ok('A8a picker=0 → P', r8a[0].includes('xPy'));
ok('A8b picker=0.99 → Q', r8b[0].includes('xQy'));

/* ================================================================
 * B. TheaterData.rollWorldBook() / clearRollResult()
 * ================================================================ */
// 用源码扫描验证（避免在 Node 中模拟 window.VirtualPhone 的复杂度）
const TD_SRC = read('apps/theater/theater-data.js');

// B1: rollWorldBook 方法存在且是 async
ok('B1 rollWorldBook 方法存在', TD_SRC.includes('async rollWorldBook()'));

// B2: 无 manager 时返回 no-manager
ok('B2 no-manager 兜底', TD_SRC.includes("return { ok: false, reason: 'no-manager' }"));

// B3: 禁用时返回 disabled
ok('B3 disabled 兜底', TD_SRC.includes("return { ok: false, reason: 'disabled' }"));

// B4: 无条目时返回 no-entries
ok('B4 no-entries 兜底', TD_SRC.includes("return { ok: false, reason: 'no-entries' }"));

// B5: 成功时写入 draft.rollResult 并保存
ok('B5 写入 draft.rollResult', TD_SRC.includes("this.draft.rollResult = rolled.join('\\n\\n')"));
ok('B5b _save() 被调用', /this\.draft\.rollResult\s*=\s*rolled\.join\([^)]+\);\s*\n\s*this\._save\(\)/.test(TD_SRC));

// B6: 返回 { ok: true, count }
ok('B6 返回 ok+count', TD_SRC.includes('return { ok: true, count: rolled.length }'));

// B7: clearRollResult 方法存在
ok('B7 clearRollResult 存在', TD_SRC.includes('clearRollResult()'));
ok('B7b 清空并保存', TD_SRC.includes("this.draft.rollResult = '';\n    this._save();"));

// B8: 调用了 rollWorldBookEntries
ok('B8 rollWorldBookEntries 被调用', TD_SRC.includes('const rolled = rollWorldBookEntries(allEntries)'));

/* ================================================================
 * C. 视图层：theater-view.js
 * ================================================================ */
const TV_SRC = read('apps/theater/theater-view.js');

// C1: th-roll 面板 HTML
ok('C1 th-roll div 存在', TV_SRC.includes('<div class="th-roll">'));
ok('C1b th-roll-btn 按钮', TV_SRC.includes('id="th-roll"'));
ok('C1c th-roll-status span', TV_SRC.includes('id="th-roll-status"'));
ok('C1d th-roll-clear 按钮', TV_SRC.includes('id="th-roll-clear"'));
ok('C1e th-roll-preview pre', TV_SRC.includes('id="th-roll-preview"'));

// C2: 事件绑定
ok('C2 th-roll 事件绑定', TV_SRC.includes("q('#th-roll')?.addEventListener('click', async ()"));
ok('C2b th-roll-clear 事件绑定', TV_SRC.includes("q('#th-roll-clear')?.addEventListener('click'"));

// C3: 调用 data.rollWorldBook()
ok('C3 rollWorldBook 调用', TV_SRC.includes('data.rollWorldBook()'));
ok('C3b clearRollResult 调用', TV_SRC.includes('data.clearRollResult()'));

// C4: 状态更新
ok('C4 状态文字更新', TV_SRC.includes("status.textContent = '已抽 '"));
ok('C4b 预览更新', TV_SRC.includes("q('#th-roll-preview').textContent"));

/* ================================================================
 * D. CSS
 * ================================================================ */
const CSS_SRC = read('apps/theater/theater.css');
ok('D1 .th-roll 样式', CSS_SRC.includes('.th-roll'));
ok('D2 .th-roll-preview 样式', CSS_SRC.includes('.th-roll-preview'));
ok('D3 .th-roll-btn 样式', CSS_SRC.includes('.th-roll-btn'));
ok('D4 .th-roll-clear 样式', CSS_SRC.includes('.th-roll-clear'));

/* ================================================================
 * E. 发布卫生
 * ================================================================ */
const IDX = read('index.js');
const MANIFEST = JSON.parse(read('manifest.json'));
const PKG = JSON.parse(read('package.json'));
const LOG = JSON.parse(read('update-log.json'));

const V = '2.38.0';
const HEADV = LOG.latest;
/* [v2.39.0] 交棓：原 E1-E5c 钉死 V=2.38.0，每发一版必翻红。
   改自洽性不变量（三处版本同源 + latest=头部 + 公告与 HEAD 逐字同源）。 */
const VNUM = (s) => { const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(String(s || '').trim()); return m ? Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3]) : NaN; };
const idxVer = (/ST_PHONE_VERSION = '([^']+)'/.exec(IDX) || [])[1];
ok('E1 三处版本同源', idxVer && idxVer === MANIFEST.version && idxVer === PKG.version, `${idxVer}/${MANIFEST.version}/${PKG.version}`);
ok('E2 版本不低于 2.38.0', VNUM(idxVer) >= VNUM(V), String(idxVer));
ok('E3 update-log.latest 指向 versions 头部（自洽）', HEADV === Object.keys(LOG.versions)[0], `${HEADV}`);
ok('E4 HEAD 条目非空', LOG.versions[HEADV] && Array.isArray(LOG.versions[HEADV].items) && LOG.versions[HEADV].items.length >= 4);
const annMatch = /ST_PHONE_CURRENT_UPDATE\s*=\s*\{([\s\S]*?)\n\};/.exec(IDX);
ok('E5 公告块存在', !!annMatch);
if (annMatch && LOG.versions[HEADV]) {
    const annItems = [...annMatch[1].matchAll(/["'](.*?)["']/g)].map(m => m[1]).filter(s => s.length > 10);
    const logItems = LOG.versions[HEADV].items;
    ok('E5b 公告条数一致', annItems.length === logItems.length);
    ok('E5c 公告与 HEAD 逐字同源', logItems.every((item, i) => annItems[i] === item));
} else {
    ok('E5b 公告条数一致', false, 'skipped');
    ok('E5c 公告与 HEAD 逐字同源', false, 'skipped');
}

// E6: rollWorldBookEntries 真被消费（非定义行）
const allFiles = ['apps/theater/theater-data.js', 'apps/theater/theater-view.js', 'index.js'];
let prodCount = 0;
for (const f of allFiles) {
    const src = read(f);
    const lines = src.split('\n');
    for (const line of lines) {
        if (line.includes('rollWorldBookEntries') && !line.includes('export function rollWorldBookEntries')) {
            prodCount++;
        }
    }
}
ok('E6 rollWorldBookEntries 被消费(>=1处非定义)', prodCount >= 1);

/* ================================================================ */
console.log(`\n[v238] ${pass}/${pass + fail} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
