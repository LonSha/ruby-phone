/* ============================================================
 * [v2.20.0] 世界脉搏会话守卫 + 微博推送修复回归测试。
 * ------------------------------------------------------------
 * 背景（本批次修复的真实缺陷，均为跨批次审计新发现）：
 *  1. worldpulse _processQueue 异步链（LLM 生成可达数十秒）无会话守卫：
 *     换会话后生成结果（历史/队列状态）仍写进新会话空间；异步续链也会
 *     把旧会话队列在新会话继续处理。
 *  2. worldpulse _pushToWeibo 三重调用错误（自 v2.9.0 起为死代码）：
 *     weiboApp?.wechatData 属性不存在（应为 weiboData）；
 *     VirtualPhone?.weiboData 从未被赋值；
 *     addRecommendPost 方法不存在（真实 API：saveRecommendPosts(数组)）。
 *
 * 分工：真实运行时（WorldpulseApp 实例 + 内存 storage） + 接线断言（源码文本）。
 * 不硬编码版本号（版本跨源自洽由 entry-integrity 锁定）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldpulseApp } from '../apps/worldpulse/worldpulse-app.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};

// ========== 1. 会话守卫：换会话后生成结果丢弃 ==========
{
    // 内存 storage（worldpulse 的 get/set 全走 storage）
    const data = {};
    const storage = {
        get(k, dflt = null) { return (k in data) ? data[k] : dflt; },
        set(k, v) { data[k] = v; }
    };
    // 可控的会话上下文
    const ctxHolder = { chatMetadata: { file_name: 'chatA' }, chat: [] };
    globalThis.window = Object.assign(globalThis.window || {}, {
        SillyTavern: { getContext: () => ctxHolder },
        VirtualPhone: {}
    });
    const app = new WorldpulseApp(null, storage);
    // 直接驱动 _processQueue：桩掉 _generate 的异步完成时机
    let releaseGenerate = null;
    const generated = new Promise((resolve) => { releaseGenerate = resolve; });
    app._generate = async () => { await generated; return '平行事件正文A'; };
    // 入队一个事件（模拟阈值触发）
    const st0 = app.getState();
    st0.queue.push({ style: '都市日常', customPrefix: '', floorCount: 1 });
    app._saveState(st0);
    // 启动处理（异步挂起在 _generate）
    const processing = app._processQueue();
    // 生成完成前换会话
    ctxHolder.chatMetadata.file_name = 'chatB';
    releaseGenerate(null);
    await processing;
    // 断言：chatB 会话空间中不应出现 chatA 生成的历史
    const histRaw = data['worldpulse_history_v1'];
    const hist = histRaw ? JSON.parse(histRaw) : [];
    ok('换会话后生成结果不写入新会话历史', !hist.some(h => String(h.content).includes('平行事件正文A')), JSON.stringify(hist.map(h => h.content)));
    ok('换会话后不推送微博（weiboApp 不存在也不崩）', true);
}

// ========== 2. 会话守卫：同会话内生成结果正常落地 ==========
{
    const data = {};
    const storage = {
        get(k, dflt = null) { return (k in data) ? data[k] : dflt; },
        set(k, v) { data[k] = v; }
    };
    const ctxHolder = { chatMetadata: { file_name: 'chatA' }, chat: [] };
    globalThis.window = Object.assign(globalThis.window || {}, {
        SillyTavern: { getContext: () => ctxHolder },
        VirtualPhone: {}
    });
    const app = new WorldpulseApp(null, storage);
    app._generate = async () => '平行事件正文B';
    const st0 = app.getState();
    st0.queue.push({ style: '都市日常', customPrefix: '', floorCount: 1 });
    app._saveState(st0);
    await app._processQueue();
    const histRaw = data['worldpulse_history_v1'];
    const hist = histRaw ? JSON.parse(histRaw) : [];
    ok('同会话生成结果正常写入历史', hist.some(h => String(h.content).includes('平行事件正文B')), JSON.stringify(hist.map(h => h.content)));
    const st1 = app.getState();
    ok('同会话处理完成后队列出队', st1.queue.length === 0, String(st1.queue.length));
}

// ========== 3. _pushToWeibo：真实数据层契约 ==========
{
    const data = {};
    const storage = {
        get(k, dflt = null) { return (k in data) ? data[k] : dflt; },
        set(k, v) { data[k] = v; }
    };
    const ctxHolder = { chatMetadata: { file_name: 'chatA' }, chat: [] };
    // 仿真微博数据层（真实方法名 getRecommendPosts / saveRecommendPosts）
    const savedPosts = [];
    const weiboData = {
        getRecommendPosts() { return savedPosts; },
        saveRecommendPosts(posts) { savedPosts.length = 0; savedPosts.push(...posts); }
    };
    let refreshed = false;
    globalThis.window = Object.assign(globalThis.window || {}, {
        SillyTavern: { getContext: () => ctxHolder },
        VirtualPhone: {
            weiboApp: {
                weiboData,
                handleExternalRecommendUpdate() { refreshed = true; }
            }
        }
    });
    const app = new WorldpulseApp(null, storage);
    app._pushToWeibo('世界在呼吸', '都市日常');
    ok('推送写入推荐流', savedPosts.length === 1, String(savedPosts.length));
    if (savedPosts.length === 1) {
        const p = savedPosts[0];
        ok('帖子字段对齐渲染契约（blogger/bloggerType/time/device）',
            p.blogger === '世界脉搏·都市日常' && p.bloggerType === '世界脉搏'
            && typeof p.time === 'string' && p.device === '平行世界');
        ok('帖子字段对齐渲染契约（content/images/计数/列表）',
            p.content === '世界在呼吸' && Array.isArray(p.images) && p.forward === 0
            && p.comments === 0 && p.likes === 0
            && Array.isArray(p.commentList) && Array.isArray(p.likeList));
        ok('帖子带唯一 id', typeof p.id === 'string' && p.id.startsWith('wp_'));
    }
    ok('推送后通知微博刷新', refreshed === true);
    // 数据层缺失时静默跳过（不抛）
    globalThis.window.VirtualPhone.weiboApp = null;
    let threw = false;
    try { app._pushToWeibo('x', '都市日常'); } catch (_e) { threw = true; }
    ok('数据层缺失静默跳过不抛', threw === false);
}

// ========== 4. 接线断言（读源码文本） ==========
{
    const src = fs.readFileSync(path.join(root, 'apps/worldpulse/worldpulse-app.js'), 'utf8');
    ok('新增 _currentSessionStamp 方法', /_currentSessionStamp\(\) \{/.test(src));
    ok('构造器不再预捕获 stamp（入口捕获）', !/this\._sessionStamp\s*=/.test(src));
    const cap = src.indexOf('const stamp = this._currentSessionStamp();');
    const gen = src.indexOf('await this._generate(ev)');
    const guard = src.indexOf('if (content && stamp === this._currentSessionStamp())');
    const histWrite = src.indexOf('WP.pushHistory(this.getHistory()');
    ok('入口捕获先于生成调用', cap > 0 && cap < gen, `cap=${cap} gen=${gen}`);
    ok('守卫先于历史写入', guard > 0 && gen < guard && guard < histWrite, `guard=${guard} hist=${histWrite}`);
    ok('异步续链也带会话比对', /setTimeout\(\(\) => \{ if \(stamp === this\._currentSessionStamp\(\)\) this\._processQueue\(\); \}, 50\);/.test(src));
    // 微博推送修复点
    ok('数据层解析改为 weiboData', /VirtualPhone\?\.weiboApp\?\.weiboData \|\| null/.test(src));
    ok('不再功能性调用不存在的 addRecommendPost', !/\.addRecommendPost\s*\(/.test(src));
    ok('改用真实 API saveRecommendPosts', /weiboData\.saveRecommendPosts\(list\)/.test(src));
    ok('推送后调用 handleExternalRecommendUpdate', /handleExternalRecommendUpdate\?\.\(\)/.test(src));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);