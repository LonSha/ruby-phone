// tests/r24_x9_lock_screen.test.mjs — R24-X9 判据：锁屏与「今天」
// 纪律：unknown 不塌成 0；全 0 不等于全未知；点通知必须直达锚；锁屏可与 App 读数同源对拍。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    LOCK_SECTIONS, LOCK_FACES, buildLockFace, notificationTarget, sameSource, lockScreenSelfCheck
} from '../config/lock-screen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

const facts = {
    storyClock: { face: 'known', value: { hour: 23, minute: 7 } },
    storyDate: { face: 'known', value: { year: 2026, month: 11, day: 18 } },
    weather: { face: 'known', value: { temp: -3, desc: '雪' } },
    unread: { face: 'known', value: 0 }
};
const today = { msgs: { face: 'known', value: 42 }, diary: { face: 'known', value: 1 }, schedule: { face: 'known', value: 0 } };
const full = buildLockFace({ facts, today, settings: { lockScreen: true } });

ok('五块读数齐', LOCK_SECTIONS.length === 5 && full.sections.length === 5);
ok('齐全 = ready', full.face === 'ready' && full.missing.length === 0);
ok('剧情钟（含补零）', full.sections[0].text === '23:07');
ok('日期', full.sections[1].text.indexOf('2026') === 0);
ok('天气带温度', full.sections[2].text.indexOf('雪') !== -1 && full.sections[2].text.indexOf('-3') !== -1);
ok('已知 0 未读 = 「没有未读」', full.sections[3].text === '没有未读' && full.sections[3].value === 0);
ok('今日摘要不藏 0', full.sections[4].text.indexOf('日程 0') !== -1);

const staleClock = buildLockFace({ facts: Object.assign({}, facts, { storyClock: { face: 'stale', value: { hour: 8, minute: 0 } } }), today });
ok('stale 仍显示值且标 stale', staleClock.sections[0].face === 'stale' && staleClock.sections[0].text === '08:00');

const offUnread = buildLockFace({ facts: Object.assign({}, facts, { unread: { face: 'unknown', reason: 'publisher-off' } }), today });
ok('未上电 = unknown（不是 0）', offUnread.sections[3].face === 'unknown' && offUnread.sections[3].value === null);
ok('unknown 文案与 0 不同形', offUnread.sections[3].text !== '没有未读');
ok('缺块 → partial + missing', offUnread.face === 'partial' && offUnread.missing.join(',') === 'unread');

const noFact = buildLockFace({ facts: {}, today: {} });
ok('全缺时每块都保留位置（不塌成一句话）', noFact.sections.length === 5 && noFact.face === 'partial');
ok('缺块有原因码', noFact.sections[0].reason === 'not-provided');
ok('全未知摘要 ≠ 全 0 摘要', noFact.sections[4].text === '今天的数据还没准备好');

const zeros = buildLockFace({
    facts,
    today: { msgs: { face: 'known', value: 0 }, diary: { face: 'known', value: 0 }, schedule: { face: 'known', value: 0 } }
});
ok('全 0 = 「今天还没有什么」', zeros.sections[4].text === '今天还没有什么');
ok('全 0 与全未知不同形', zeros.sections[4].text !== noFact.sections[4].text);

const disabled = buildLockFace({ settings: { lockScreen: false } });
ok('可关：关掉直达桌面', disabled.face === 'disabled' && disabled.bypassTo === 'home' && disabled.sections.length === 0);
ok('关掉时不读任何事实', disabled.missing.length === 0);

ok('无锚通知不算直达（负控制）', notificationTarget({ appId: 'wechat' }).face === 'unresolved');
ok('无 App 不算直达', notificationTarget({ conversationId: 'c1' }).reason === 'no-app');
const tg = notificationTarget({ appId: 'wechat', conversationId: 'c1' });
ok('到会话即算直达', tg.face === 'resolved' && tg.conversationId === 'c1');
ok('同源对拍一致', sameSource(facts, facts, 'unread').same === true);
ok('一边 unknown 不许判同源', sameSource(facts, { unread: { face: 'unknown' } }, 'unread').same === false);
ok('自检绿', lockScreenSelfCheck().ok === true);
ok('四态登记', ['ready', 'partial', 'disabled', 'malformed'].every((f) => typeof LOCK_FACES[f] === 'string'));

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/lock-screen.js'"));
ok('接线：桥表真登记 _r24X9', indexSrc.includes("'_r24X9'") || indexSrc.includes('["_r24X9"') || indexSrc.includes("['_r24X9'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);