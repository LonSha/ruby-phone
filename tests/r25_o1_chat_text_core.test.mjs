/* ============================================================
 * tests/r25_o1_chat_text_core.test.mjs — R25-O1 第一刀（chat-view 文本解析内核）
 * ------------------------------------------------------------
 * 「拆骨」最容易做成的两种假交付：
 *   ① 复制一份再到别处改：看起来文件小了，实际多了一份实现（第二份派生规则）；
 *   ② 顺手重写：搬的时候「顺手优化」，行为悄悄变了，谁也看不出来。
 * 所以这一套判据只认三种证据：
 *   · **搬前**代码的输出被录成 golden（tests/audit/chat-text-core.golden.json，43 个用例，
 *     含空串 / 坏输入 / 未闭合括号 / 群呼标注 / 无宿主的时间推进命令）；
 *   · 搬后逐条对拍 —— 任一条不同即红；
 *   · 原文件里**不再有**这些方法的定义，且混入点与 import 都在场。
 * 另加一条负控制：把提取件改坏一处，golden 对拍必须转红（证明这套对拍有分辨力，不是摆设）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ChatView } from '../apps/wechat/chat-view.js';
import { chatTextCore } from '../apps/wechat/chat-text-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function codeOf(text) {
    const noBlock = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
    return noBlock.split('\n').filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*');
    }).join('\n');
}
const GOLDEN = JSON.parse(read('tests/audit/chat-text-core.golden.json'));

/** 与录制 golden 时**同一张输入表**（顺序也一致，对拍才成立）。 */
const CASES = {
    cleanAbnormalSpaces: [[undefined], [null], [''], ['a b c'], ['不 过 如 果 这 样 说 的 话 就 好 了'], ['中 文 无 空 格'], ['hello world this is fine'], ['字 字 字 字']],
    _readBracketGroupAt: [['（甲）', 0], ['(b)', 0], ['x（甲）', 1], ['（未闭合', 0], ['', 0], ['（）', 0], ['（a（b）c）tail', 0], ['中文', 0]],
    _parseIncomingCallMarker: [[''], [null], ['普通消息'], ['[拨打语音]'], ['【发起视频通话】'], ['[拨打群语音通话] 一起'], ['【 发起 微信群视频 】']],
    _extractQuickReplyPayload: [['[图片]（海边日落）', 'image'], ['[视频](片段)', 'video'], ['[表情包]（猫）', 'sticker'], ['[语音条]（三秒）', 'voice-strip'], ['[定位]（咖啡馆）', 'location'], ['[时间推进：三天后]', 'time'], ['原文', 'image'], ['', 'image']],
    _parseWeiboCommentLine: [[null], [''], ['1. 小明 (ip[北京])：好看'], ['2、阿澈 回复 小明 (来自上海)：同感'], ['没有序号的行'], ['3. @网友 (IP：广州): 到此一游']],
    _parseManualTimeAdvanceCommand: [['[时间推进：三天后]'], ['不是命令'], ['']]
};
const NAMES = Object.keys(CASES);

/** 跑一张表，返回与 golden 同形的结构（undefined 值也会被 JSON 丢掉，与录制口径一致）。 */
function runTable(impl) {
    const box = {};
    const out = {};
    for (const name of NAMES) {
        out[name] = CASES[name].map((args) => {
            try { return { ok: true, v: impl[name].apply(box, args) }; }
            catch (e) { return { ok: false, e: String((e && e.message) || e) }; }
        });
    }
    return JSON.parse(JSON.stringify(out));
}

/* ---------------- 接线 ---------------- */

test('O1-1 六个方法仍在 ChatView.prototype 上（原型混入），调用点一行未改', () => {
    for (const name of NAMES) {
        assert.equal(typeof ChatView.prototype[name], 'function', name + ' 必须仍在 ChatView 原型上');
        assert.equal(typeof chatTextCore[name], 'function', name + ' 必须由 chat-text-core 提供');
    }
    /* 混入点与 import 都在场，且顺序无关（只要求在文件里出现过）。 */
    const src = codeOf(read('apps/wechat/chat-view.js'));
    assert.ok(/import \{ chatTextCore \} from '\.\/chat-text-core\.js/.test(src), 'chat-view 必须 import 提取件');
    assert.ok(/Object\.assign\(ChatView\.prototype, chatTextCore\);/.test(src), '必须真混入（import 了不混入 = 没接上）');
});

/* ---------------- 逐族对拍（搬前 vs 搬后） ---------------- */

for (const name of NAMES) {
    test('O1-对拍 · ' + name + ' 搬前搬后逐条一致（' + CASES[name].length + ' 例）', () => {
        const box = {};
        CASES[name].forEach((args, i) => {
            const got = (() => {
                try { return { ok: true, v: ChatView.prototype[name].apply(box, args) }; }
                catch (e) { return { ok: false, e: String((e && e.message) || e) }; }
            })();
            const norm = JSON.parse(JSON.stringify(got));
            assert.deepEqual(norm, GOLDEN[name][i], name + ' 第 ' + (i + 1) + ' 例与搬前不一致（入参 ' + JSON.stringify(args) + '）');
        });
    });
}

/* ---------------- 原文件真的变小了，且没留第二份 ---------------- */

test('O1-11 chat-view.js 里不再有这些方法的定义（不是复制一份留在原地）', () => {
    const src = codeOf(read('apps/wechat/chat-view.js'));
    for (const name of NAMES) {
        const def = new RegExp('^\\s{4}' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'm');
        assert.equal(def.test(src), false, name + ' 的定义不许还留在 chat-view.js（复制一份 = 两份实现）');
    }
});

test('O1-12 全仓只有 chat-text-core.js 声明这六个方法（第二份实现即红）', () => {
    const files = [];
    const walk = (dir) => {
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            const st = fs.statSync(p);
            if (st.isDirectory()) { if (!/node_modules|\.git/.test(f)) walk(p); }
            else if (/\.js$/.test(f)) files.push(p);
        }
    };
    walk(ROOT);
    for (const name of NAMES) {
        const owners = files.filter((p) => {
            if (p.endsWith(path.join('apps', 'wechat', 'chat-text-core.js'))) return false;
            const s = codeOf(fs.readFileSync(p, 'utf8'));
            const def = new RegExp('(^|\\n)\\s{0,8}' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)\\s*\\{', 'm');
            return def.test(s);
        }).map((p) => path.relative(ROOT, p));
        assert.deepEqual(owners, [], name + ' 在别处还有定义：' + owners.join(', '));
    }
});

test('O1-13 切小了，但没把一座单体换成另一座（行数上限写死）', () => {
    const view = read('apps/wechat/chat-view.js').split('\n').length;
    const core = read('apps/wechat/chat-text-core.js').split('\n').length;
    /* [R25-O2 订正] 18340 是 O1 拆骨刚切完时的上界。O2 在同一个 view 里接了滚动记忆四处
     * （记账 / 恢复 / 绑定 / 读数上屏）+ 让位规则，行数回涨到 18457 —— 这是**接线**，不是把拆掉的东西搬回来：
     * chat-text-core.js 仍是 199 行、O1 的 7 个方法仍只在核心里有一份（上面 O1-12 逐字查）。
     * 所以上界钉到当前真值，棘轮方向不变（下次再涨必须再改这里并写理由）。台账 note 同步记账。 */
    /* 数法要写清楚：这里用 split('\n').length，末尾换行会多算一段，所以 18458 就是 wc -l 的 18457。 */
    assert.ok(view <= 18458, 'chat-view.js 不得再涨（当前 ' + view + ' 段 = wc -l 的 ' + (view - 1) + ' 行；O1 搬后 wc 18323 / O2 接线后 18457 / 搬前 18450）');
    assert.ok(core <= 220, '提取件必须是小件（当前 ' + core + ' 行）—— 拆骨不是搬家');
});

/* ---------------- 负控制 ---------------- */

test('O1-14 负控制 · 把提取件改坏一处 ⇒ golden 对拍必须转红', async () => {
    /* 破坏形态选「看着更像对的」那一种：把「异常空格出现 3 次以上才清理」改成 4 次以上。
     *   不抛错、不缺字段，只是边界偏了一格 —— 靠人眼看不出，只有对拍能抓。 */
    const src = read('apps/wechat/chat-text-core.js');
    const from = 'matches.length >= 3';
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次');
    const broken = src.replace(from, 'matches.length >= 4');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_o1_'));
    const file = path.join(dir, 'chat-text-core.broken.js');
    /* 临件与提取件同目录依赖不行（在 /tmp），所以把两个依赖也复制过去。 */
    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'num-gate.js'));
    fs.copyFileSync(path.join(ROOT, 'config', 'time-source.js'), path.join(dir, 'time-source.js'));
    fs.writeFileSync(file, broken
        .replace("'../../config/num-gate.js'", "'./num-gate.js'")
        .replace("'../../config/time-source.js'", "'./time-source.js'"), 'utf8');
    const K2 = await import('file://' + file);
    const impl = K2.chatTextCore;
    const good = runTable(chatTextCore);
    const bad = runTable(impl);
    assert.deepEqual(good, GOLDEN, '原版必须与 golden 一致（否则这条负控制没有基准）');
    assert.notDeepEqual(bad, GOLDEN, '改坏之后 golden 对拍必须转红 —— 否则这套对拍没有分辨力');
    /* 具体红在哪：那条「字 字 字 字」只有 3 个空格，>=4 就不清理了。 */
    const idx = CASES.cleanAbnormalSpaces.findIndex((a) => a[0] === '字 字 字 字');
    assert.notDeepEqual(bad.cleanAbnormalSpaces[idx], GOLDEN.cleanAbnormalSpaces[idx]);
});