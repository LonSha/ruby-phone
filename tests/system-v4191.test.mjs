// SYS-V4191 蜜语 / 微博 两件的「文本与数值归一面」抽取验收
// 为什么只抽这一面：两件的源都是 2500~5200 行的类，类里绝大多数方法在动 this.state
//   （房间列表 / 直播生成 / 点赞缓存 / fetch 剧情），那是有副作用的编排，不能也不该在
//   本仓「纯函数内核 + 控制器 + 视图」四件套纪律下整只搬过来。
//   本件只把「给定一段文本/一个数 ⇒ 给定一个结论」的清洗面抽出来，判据因此只审两件事：
//   抽出来的内核是不是**真的纯**，以及源类是不是**真的转调**（实现不再留在编排面）。
// 实现纪律：本档不用正则，一律 indexOf（生成链会吃反斜杠，与 v4186~v4190 同一条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);

const HT = await import('../apps/honey/honey-text-core.js');
const WT = await import('../apps/weibo/weibo-text-core.js');

const HONEY_SRC = 'apps/honey/honey-data.js';
const WEIBO_SRC = 'apps/weibo/weibo-data.js';

const CORE_FILES = [
    'apps/honey/honey-text-core.js',
    'apps/weibo/weibo-text-core.js'
];

const SIDE_EFFECT_TOKENS = [
    'localStorage', 'sessionStorage', 'window.', 'document.',
    'fetch(', 'new Audio', 'XMLHttpRequest',
    'setInterval', 'setTimeout', 'requestAnimationFrame',
    'storage.set(', 'new Date('
];

/* ══════════ A 组 · 两个内核的纯度 ══════════ */
test('A1 两个内核源码面零副作用、零类', () => {
    for (const f of CORE_FILES) {
        const s = read(f);
        assert.equal(s.indexOf('Math.random'), -1, f + ' 不许自己取随机源');
        assert.equal(s.indexOf('Date.now'), -1, f + ' 不许自己读系统时钟');
        for (const bad of SIDE_EFFECT_TOKENS) {
            assert.equal(s.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
        assert.equal(s.indexOf('class '), -1, f + ' 内核不许有类');
        /* 只审代码面（去注释行后）不许持实例状态 —— 注释里说明「把 this. 去掉」不算。 */
        const codeOnly = s.split(NL).filter((l) => l.trim().indexOf('*') !== 0 && l.trim().indexOf('//') !== 0 && l.trim().indexOf('/*') !== 0).join(NL);
        assert.equal(codeOnly.indexOf('this.'), -1, f + ' 代码面不许持实例状态');
    }
});

test('A2 蜜语文本清洗：剥 HTML / 折叠空白 / 截断，同一输入同一结果', () => {
    const a = HT.sanitizeInlineText('  <b>凌晨</b>的   面馆  ', 12);
    const b = HT.sanitizeInlineText('  <b>凌晨</b>的   面馆  ', 12);
    assert.equal(a, b, '同一输入必须同一结果');
    assert.equal(a, '凌晨 的 面馆', '标签剥成空格、连续空白折叠、再截断');
    assert.equal(HT.sanitizeInlineText(null), '', 'null 洗成空串');
    assert.equal(HT.sanitizeInlineText('<i>x</i>'), 'x');
    assert.equal(HT.sanitizeInlineText('0123456789ABCDEF', 4), '0123', '按 maxLen 截断');
    assert.equal(HT.sanitizePromptLine('  <i>灯</i>  还亮着  '), '灯 还亮着', '单行不截断');
    assert.equal(HT.sanitizePromptBlockLine('甲\r\n乙'), '甲' + NL + '乙', '块行只去回车，保留换行');
});

test('A3 蜜语数值钳制：好感度 0~100 一位小数，读不出不编 0', () => {
    assert.equal(HT.clampFavorability('123.456', null), 100, '超上限钳到 100');
    assert.equal(HT.clampFavorability('-9.96', null), 0, '负值钳到下限 0（源类口径）');
    assert.equal(HT.clampFavorability('55.55', null), 55.6, '一位小数');
    assert.equal(HT.clampFavorability('', null), null, '读不出给 fallback，不编 0');
    assert.equal(HT.clampFavorability('abc', 7), 7, 'fallback 由调用方给');
    assert.equal(HT.clampReferenceValue('1.987'), 1, '超上限钳到 1');
    assert.equal(HT.clampReferenceValue('-3'), 0, '低于下限钳到 0');
    assert.equal(HT.clampReferenceValue('0.005'), 0.01, '两位小数');
    assert.equal(HT.clampReferenceValue('坏', 0.7), 0.7, '读不出给默认 fallback');
    assert.equal(HT.clampReferenceValue('坏', 0.7, 0, 10), 0.7, 'min/max 由调用方给');
});

test('A4 蜜语参考图归一：只放行 http(s) 与站内 backgrounds/', () => {
    assert.equal(HT.normalizeNaiReferenceImage('https://a.test/x.png'), 'https://a.test/x.png');
    assert.equal(HT.normalizeNaiReferenceImage('/backgrounds/y.webp'), '/backgrounds/y.webp');
    assert.equal(HT.normalizeNaiReferenceImage('data:image/png;base64,AAAA'), '', '内联 base64 一律退回');
    assert.equal(HT.normalizeNaiReferenceImage('[object Object]'), '', '占位串退回');
    assert.equal(HT.normalizeNaiReferenceImage('undefined'), '', 'undefined 串退回');
    assert.equal(HT.normalizeNaiReferenceImage('null'), '', 'null 串退回');
    assert.equal(HT.normalizeNaiReferenceImage('javascript:alert(1)'), '', '其它协议退回');
    assert.equal(HT.normalizeNaiReferenceImage(''), '', '空串退回');
});

test('A5 蜜语评论行归一：状态行剔除 / 等级改写 / 无人称补匿名', () => {
    assert.equal(HT.isCommentStatusLine(''), true, '空行算状态行');
    assert.equal(HT.isCommentStatusLine('好感度：72%'), true);
assert.equal(HT.isCommentStatusLine('当前好感值：72'), true);
    assert.equal(HT.isCommentStatusLine('好感值：72'), true);
    /* 【】等级前缀包着的状态行不命中（源类正则的等级组只覆盖无前缀形态）——
       这正是「粉丝等级行会被当真评论」的已知边界，判据把它钉住。 */
    assert.equal(HT.isCommentStatusLine('【热评】当前好感值：72'), false, '带等级前缀的状态行不命中（源类口径，已知边界）');
    assert.equal(HT.isCommentStatusLine('系统公告：当前好感度 72'), true, '系统公告包装的状态行也算');
    assert.equal(HT.isCommentStatusLine('系统公告：今晚八点开播'), false, '普通系统公告不是状态行');
    assert.equal(HT.isCommentStatusLine('阿茶：这家真不错'), false, '真评论不是状态行');

    assert.equal(HT.normalizeCommentLine(''), '');
    assert.equal(HT.normalizeCommentLine('（系统提示）'), '', '纯括号行剔除');
    assert.equal(HT.normalizeCommentLine('----'), '', '分隔线行剔除');
    assert.equal(HT.normalizeCommentLine('[评论区]'), '', '评论区标记行剔除');
    assert.equal(HT.normalizeCommentLine('简介：今晚八点'), '', '简介行剔除');
    assert.equal(HT.normalizeCommentLine('生成10条评论'), '', '指令行剔除');
    assert.equal(HT.normalizeCommentLine('不少于5条'), '', '指令行剔除');
    assert.equal(HT.normalizeCommentLine('【热评】阿茶: 这家真不错'), '[热评]阿茶: 这家真不错', '方括号等级');
    assert.equal(HT.normalizeCommentLine('【粉丝】阿茶: 不错'), '[热评]阿茶: 不错', '「粉丝」等级改写为「热评」');
    assert.equal(HT.normalizeCommentLine('1. 阿茶：在吗'), '阿茶: 在吗', '序号前缀剥掉');
    assert.equal(HT.normalizeCommentLine('- 在吗'), '匿名: 在吗', '无人称行补匿名');
    assert.equal(HT.normalizeCommentLine('【热评】这家真不错'), '[热评]匿名: 这家真不错', '有等级无人称也要补匿名');
});

test('A6 微博内核：相对时间互转与 @人名归一', () => {
    assert.equal(WT.parseRelativeTimeToMinutes('3小时前'), 180);
    assert.equal(WT.parseRelativeTimeToMinutes('25分钟前'), 25);
    assert.equal(WT.parseRelativeTimeToMinutes('2天前'), 2 * 24 * 60);
    assert.equal(WT.parseRelativeTimeToMinutes('1周前'), 7 * 24 * 60);
    assert.equal(WT.parseRelativeTimeToMinutes('刚刚'), 0);
    assert.equal(WT.parseRelativeTimeToMinutes('昨天 21:30'), 0, '认不出的相对词按 0 走（源类口径，不编分钟）');
    assert.equal(WT.formatRelativeTimeFromMinutes(180), '3小时前');
    assert.equal(WT.formatRelativeTimeFromMinutes(0), '刚刚');
    assert.equal(WT.formatRelativeTimeFromMinutes(25), '25分钟前');
    assert.equal(WT.formatRelativeTimeFromMinutes(2 * 24 * 60), '2天前');
    assert.equal(WT.formatRelativeTimeFromMinutes(-5), '刚刚', '负数不产出「-5分钟前」');
    assert.equal(WT.normalizeAtName('阿茶'), '@阿茶', '补 @ 前缀');
    assert.equal(WT.normalizeAtName('@阿茶'), '@阿茶', '已有 @ 不重复补');
    assert.equal(WT.normalizeAtName('', '网友'), '@网友', '空名落到 fallback');
    assert.equal(WT.normalizeBareName('@阿茶'), '阿茶', '剥掉 @');
    assert.equal(WT.stripDuplicateReplyMention('阿茶：在吗', '阿茶'), '在吗', '开头重复称呼剥掉');
    assert.equal(WT.stripDuplicateReplyMention('@阿茶：在吗', '@阿茶'), '在吗', '带 @ 的重复称呼也剥掉');
    assert.equal(WT.stripDuplicateReplyMention('阿茶 回复 阿茶：在吗', '阿茶'), '阿茶 回复 阿茶：在吗', '「A 回复 A：」不是称呼前缀，不动');
    assert.equal(WT.stripDuplicateReplyMention('小满：在吗', '阿茶'), '小满：在吗', '称呼不是回复对象时不剥');
    assert.equal(WT.parseFollowerNumber('1.2万'), 12000);
    assert.equal(WT.parseFollowerNumber('abc'), null, '读不出返回 null 不编 0');
});

test('A7 微博评论行解析：IP 属地与「回复」两种形态', () => {
    const withIp = WT.parseCommentLine('@阿茶（IP属地：北京）：这家真不错');
    assert.equal(withIp.ok, true, '标准形态必须解析成功');
    assert.equal(withIp.out.name, '@阿茶', 'name 统一带 @ 前缀');
    assert.equal(withIp.out.location, '北京');
    assert.equal(withIp.out.text, '这家真不错');
    assert.equal(withIp.out.replyTo, null, '非回复形态 replyTo 给 null');
    const reply = WT.parseCommentLine('阿茶 回复 小满：在吗');
    assert.equal(reply.ok, true);
    assert.equal(reply.out.name, '@阿茶');
    assert.equal(reply.out.replyTo, '@小满', 'replyTo 统一带 @ 前缀');
    assert.equal(reply.out.text, '在吗');
    assert.equal(WT.parseCommentLine('').ok, false, '空行不是评论');
    assert.equal(WT.parseCommentLine('').reason, WT.WEIBO_REJECT.notComment);
    assert.equal(WT.parseCommentLine(null).ok, false, '非字符串不是评论');
    assert.equal(WT.parseCommentLine('没有冒号的一行').ok, false, '无冒号切分不出评论');
    assert.equal(WT.parseCommentLine('没有冒号的一行').reason, WT.WEIBO_REJECT.notComment, '切不出按 notComment 拒答');
    assert.equal(WT.parseCommentLine('好感度：72%').ok, true, '微博侧没有状态行识别，「好感度：72%」按普通评论收');
    assert.equal(WT.parseCommentLine('@阿茶（IP属地：北京）：这家真不错').reason, null, '解析成功 reason 给 null');
});

/* ══════════ B 组 · 源类真的转调了 ══════════ */
test('B1 蜜语源类 8 个方法体已转调内核，实现不再留在编排面', () => {
    const s = read(HONEY_SRC);
    const calls = [
        '_htSanitizeInlineText(', '_htSanitizePromptLine(', '_htSanitizePromptBlockLine(',
        '_htClampFavorability(', '_htClampReferenceValue(', '_htNormalizeNaiReferenceImage(',
        '_htIsCommentStatusLine(', '_htNormalizeCommentLine('
    ];
    for (const c of calls) {
        assert.notEqual(s.indexOf(c), -1, HONEY_SRC + ' 必须转调 ' + c);
    }
    /* 转调必须出现在方法体里（等宽 8 空格缩进的方法行），不是只写在 import 段。 */
    for (const c of calls) {
        const needle = NL + '        return ' + c;
        assert.notEqual(s.indexOf(needle), -1, HONEY_SRC + ' 的 ' + c + ' 必须是方法体一行转调');
    }
    /* import 段用的是别名（_ht 前缀）引入内核函数。 */
    assert.notEqual(s.indexOf('sanitizeInlineText as _htSanitizeInlineText'), -1, '必须用别名引入内核函数');
    assert.notEqual(s.indexOf('as _htSanitizeInlineText'), -1, '必须用别名引入');
    /* 旧的本地实现标志必须消失（只审本版抽走的 8 个方法体，别处独立的 HTML 剥除不属本版范围）。 */
    const oldImpl = [
        'Math.round(clamped * 10) / 10', '好感度钳制不许再留在源类',
        'rawRank === \'粉丝\'', '等级改写不许再留在源类',
        'const fallbackUserSplit = text.match(', '评论行的用户切分不许再留在源类',
        'raw === \'[object Object]\'', '参考图占位串判定不许再留在源类',
        'const num = Number.parseFloat(value);', '数值钳制的读数不许再留在源类'
    ];
    for (let k = 0; k < oldImpl.length; k += 2) {
        assert.equal(s.indexOf(oldImpl[k]), -1, oldImpl[k + 1]);
    }
});

test('B2 蜜语源类 import 段真的引入了内核', () => {
    const s = read(HONEY_SRC);
    assert.notEqual(s.indexOf("} from './honey-text-core.js';"), -1, '必须从同目录内核引入');
    for (const name of ['sanitizeInlineText', 'clampFavorability', 'normalizeCommentLine', 'isCommentStatusLine']) {
        assert.notEqual(s.indexOf(name), -1, 'import 段必须点到 ' + name);
    }
});

test('B3 微博源类 7 个方法体已转调内核', () => {
    const s = read(WEIBO_SRC);
    const calls = [
        '_wtParseRelativeTimeToMinutes(', '_wtFormatRelativeTimeFromMinutes(',
        '_wtNormalizeAtName(', '_wtNormalizeBareName(', '_wtStripDuplicateReplyMention(',
        '_wtParseFollowerNumber('
    ];
    for (const c of calls) {
        assert.notEqual(s.indexOf(c), -1, WEIBO_SRC + ' 必须转调 ' + c);
        assert.notEqual(s.indexOf(NL + '        return ' + c), -1, WEIBO_SRC + ' 的 ' + c + ' 必须是方法体一行转调');
    }
    /* _wtParseCommentLine 因内核返回 {ok,reason,out} 而源类口径是「不是评论给 null」，
       透传写在两行里（const r = ...; return r.ok ? r.out : null;）。 */
    assert.notEqual(s.indexOf('const r = _wtParseCommentLine(rawLine);'), -1, WEIBO_SRC + ' 必须透传 _wtParseCommentLine');
    assert.notEqual(s.indexOf('r.ok ? r.out : null'), -1, '透传必须保留源类「不是评论给 null」口径');
    assert.notEqual(s.indexOf("} from './weibo-text-core.js';"), -1, '必须从同目录内核引入');
});

/* ══════════ C 组 · 控制器 ══════════ */
test('C1 蜜语控制器：六个试算口全部走 _record 与 writeReceipt', () => {
    const s = read('apps/honey/honey-text-app.js');
    assert.notEqual(s.indexOf('export class HoneyTextApp'), -1, '控制器导出 HoneyTextApp');
    assert.notEqual(s.indexOf("import { writeReceipt } from '../../config/write-receipt.js';"), -1, '落盘只走 writeReceipt');
    assert.equal(s.indexOf('storage.set('), -1, '不许直写存储');
    assert.notEqual(s.indexOf('this._record('), -1, '试算必须留快照');
    assert.notEqual(s.indexOf('this._saveSnapshot()'), -1, '快照必须落盘');
    for (const m of ['inline(', 'promptLine(', 'favorability(', 'reference(', 'image(', 'comment(']) {
        assert.notEqual(s.indexOf(m), -1, '控制器必须提供 ' + m);
    }
    /* 控制器只做编排，不许自己造随机 / 自己读时钟 / 碰 DOM。 */
    assert.equal(s.indexOf('Date.now'), -1, '控制器不许自己读时钟');
    assert.equal(s.indexOf('Math.random'), -1, '控制器不许自己取随机');
    assert.equal(s.indexOf('document.'), -1, '控制器不许碰 DOM');
});

/* ══════════ D 组 · 视图与样式 ══════════ */
test('D1 蜜语视图：_boundRoot 去重 + data-act 委派 + CSS 自注入', () => {
    const s = read('apps/honey/honey-text-view.js');
    assert.notEqual(s.indexOf('this._boundRoot === root'), -1, '必须按 root 去重绑定');
    assert.notEqual(s.indexOf('[data-act]'), -1, '必须用 data-act 委派');
    assert.notEqual(s.indexOf("new URL('./honey-text.css?v=1.0.0', import.meta.url)"), -1, '必须自注入样式');
    assert.equal(s.indexOf('addEventListener(\'input\''), -1, '视图不许监听 input');
    for (const act of ['inline', 'prompt', 'favor', 'ref', 'image', 'comment']) {
        assert.notEqual(s.indexOf('data-act="' + act + '"'), -1, '视图必须提供 ' + act + ' 试算按钮');
    }
    const css = read('apps/honey/honey-text.css');
    assert.notEqual(css.indexOf('.ht-root'), -1, '样式必须挂自己的根类');
    /* 选择器面不许碰外壳（注释里提到不算，只看非注释行）。 */
    const cssRules = css.split(NL).filter((l) => l.trim() && l.trim().indexOf('/*') !== 0 && l.trim().indexOf('*') !== 0 && l.trim().indexOf('//') !== 0).join(NL);
    assert.equal(cssRules.indexOf('.phone-screen'), -1, '样式选择器不许碰外壳');
    assert.notEqual(css.indexOf('.ht-grid'), -1, '试算按钮网格样式须在场');
    assert.notEqual(css.indexOf('.ht-flash'), -1, '回显条样式须在场');
});

/* ══════════ E 组 · 五处接线 ══════════ */
test('E1 蜜语五处接线全部在场', () => {
    const apps = read('config/apps.js');
    assert.notEqual(apps.indexOf("id: 'honeytext'"), -1, 'apps.js 必须登记 honeytext');
    assert.notEqual(apps.indexOf("defaultIcon: DEFAULT_APP_ICONS.honey"), -1, '图标须落到 honey 家族');

    const routes = read('config/app-lazy-routes.js');
    assert.notEqual(routes.indexOf('id: "honeytext"'), -1, '懒路由必须登记 honeytext');
    assert.notEqual(routes.indexOf('module: "./apps/honey/honey-text-app.js"'), -1, '懒路由模块路径须指向新控制器');
    assert.notEqual(routes.indexOf('key: "honeyTextApp"'), -1, '懒路由须给单例键 honeyTextApp');
    assert.notEqual(routes.indexOf('cls: "HoneyTextApp"'), -1, '懒路由须给类名 HoneyTextApp');

    const storage = read('config/storage.js');
    assert.notEqual(storage.indexOf('/^honey_text_/'), -1, '会话前缀必须命中 CHAT_DATA_PATTERNS');

    const keys = read('scripts/keys-audit.mjs');
    assert.notEqual(keys.indexOf("key: 'honey_text_v1'"), -1, '新键必须登记');

    const index = read('index.js');
    assert.notEqual(index.indexOf("'honeyTextApp'"), -1, '有 destroy 出口必须进重绑表');
});

test('E2 蜜语会话键真的被控制器使用（登记了不许是死键）', () => {
    const app = read('apps/honey/honey-text-app.js');
    assert.notEqual(app.indexOf("'honey_text_v1'"), -1, '控制器必须真用 honey_text_v1');
    const keys = read('scripts/keys-audit.mjs');
    const at = keys.indexOf("key: 'honey_text_v1'");
    assert.notEqual(at, -1);
    const after = keys.slice(at, at + 300);
    assert.notEqual(after.indexOf('scope: \'chat\''), -1, '登记必须是 chat 作用域');
});

/* ══════════ V 组 · 版本锚 ══════════ */
test('V1 五源版本号不低于 4.191.0', () => {
    /* [v4.195.0 修正] 五源**同源**才是本条的纪律，版本号本身不许写死 ——
       写死成 assert.equal(pkg.version, '4.191.0') 会让每往后抬一版都红一次
       （v4.193.0 立过同族先例：判据钉历史事实，不随后续抬版漂移）。
       故五源一律改成「不低于 4.191.0」的下限形，逐段语义化比较。 */
    const cmp = (a, b) => {
        const pa = String(a).split('.').map(Number);
        const pb = String(b).split('.').map(Number);
        for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
            const x = pa[k] || 0, y = pb[k] || 0;
            if (x !== y) return x < y ? -1 : 1;
        }
        return 0;
    };
    const pkg = JSON.parse(read('package.json'));
    assert.ok(cmp(pkg.version, '4.191.0') >= 0, 'package.json 必须不低于 4.191.0，当前 ' + pkg.version);
    const manifest = JSON.parse(read('manifest.json'));
    assert.ok(cmp(manifest.version, '4.191.0') >= 0, 'manifest.json 必须不低于 4.191.0，当前 ' + manifest.version);
    const log = JSON.parse(read('update-log.json'));
    assert.ok(cmp(log.latest, '4.191.0') >= 0, 'update-log latest 必须不低于 4.191.0，当前 ' + log.latest);
    assert.ok(cmp(log.head, '4.191.0') >= 0, 'update-log head 必须不低于 4.191.0，当前 ' + log.head);
    assert.ok(log.versions && log.versions['4.191.0'], 'update-log 必须有 4.191.0 条目');
    const entry = log.versions['4.191.0'];
    assert.equal(entry.version, '4.191.0');
    assert.ok(Array.isArray(entry.items) && entry.items.length >= 5, '4.191.0 条目至少 5 条');
    const joined = entry.items.join(' ');
    for (const token of ['weibo-text-core.js', 'honey-text-core.js', 'wechat']) {
        assert.notEqual(joined.indexOf(token), -1, '4.191.0 条目须提到 ' + token);
    }
    const idx = read('index.js');
    /* [v4.195.0 修正] 同族下限形：版本号字面量只活在当版公告块里，抬版即消失，
       写死它等于每抬一版必红。改为读 ST_PHONE_VERSION 常量做下限比较。 */
    const mVer = idx.match(/ST_PHONE_VERSION\s*=\s*'([^']+)'/);
    assert.ok(mVer, 'index.js 必须能取到 ST_PHONE_VERSION 常量');
    assert.ok(cmp(mVer[1], '4.191.0') >= 0, 'index.js 的 ST_PHONE_VERSION 必须不低于 4.191.0，当前 ' + mVer[1]);
    /* [v4.195.0 修正] 同族下限形：内核名只出现在**当版**公告块里，抬版即消失。
       纪律的本意是「公告块与 update-log 当版条目逐字同源」，故改为从该版自己的
       条目里取内核名，再断言它出现在 index.js 的公告块中。 */
    /* [v4.195.0 修正] 再次收窄口径：内核名只会出现在**它自己那一版**的公告块里，
       抬版后 index.js 公告块换成当版内容，历史内核名自然不在 index.js 里 ——
       这是正常抬版行为，不是缺陷。本条真正要钉的是两件事：
       ① 该内核文件仍在场（没被后续批次删掉）；
       ② 该版自己的 update-log 条目提到它（上面 token 循环已断言）。
       「公告块与当版条目逐字同源」由 v4115-G2 专门守，不在此重复。 */
    assert.ok(fs.existsSync(path.join(ROOT, 'apps/weibo', 'weibo-text-core.js')) || fs.existsSync(path.join(ROOT, 'apps/phone', 'weibo-text-core.js')), '新内核文件必须仍在场：' + 'weibo-text-core.js');
});
