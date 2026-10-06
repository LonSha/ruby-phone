// RubyPhone 入口完整性 + 存储路由回归门
// [v2.8.10 审计修复] 本测试用于防止两类已发生过的真实缺陷再次漏网：
//   P0-1 入口 index.js 语法损坏（曾连续 9 个版本无法加载，却 75 个测试全绿）
//   P0-2 会话状态键被误判为全局配置（跨会话串味）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
};

// ========== 1. 全仓库模块级语法门（含入口 index.js） ==========
// 注意：必须用 ES Module 模式解析。`node --check file.js` 走 CommonJS 分支，
// 对 ESM 语法损坏会漏报——这正是 P0-1 长期未被发现的原因。
{
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.js')) files.push(p);
    }
  };
  walk(root);

  const broken = [];
  for (const f of files) {
    try {
      // --input-type=module 强制按 ESM 解析，可暴露 import/export 与块结构错误
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: fs.readFileSync(f, 'utf8'),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      broken.push(`${path.relative(root, f)}: ${String(e.stderr || e.message).split('\n')[0]}`);
    }
  }
  ok(`全部 ${files.length} 个 JS 模块通过 ESM 语法解析`, broken.length === 0, broken.slice(0, 5).join(' | '));
  ok('入口 index.js 可被解析（插件可加载）', !broken.some(b => b.startsWith('index.js')));
}

// ========== 2. 存储路由门：会话状态必须进 chatMetadata ==========
{
  const { PhoneStorage } = await import('../config/storage.js');
  const storage = new PhoneStorage();

  const sessionKeys = [
    'ruby_unlocked_achievements', 'ruby_gacha_state', 'ruby_health_cycle',
    'ruby_playbook_state', 'ruby_reading_shelf', 'ruby_reading_progress_x',
    'ruby_tarot_history', 'ruby_tieba_posts', 'ruby_xhs_notes',
    'games_2048_state', 'games_sudoku_state', 'games_board_state',
    'games_undercover_state', 'games_poker_user_chips', 'games_poker_player_count',
    'games_poker_chips_mode', 'games_poker_selected_contact_ids',
  ];
  const globalKeys = [
    'games_poker_ai_prompt', 'games_undercover_ai_prompt', 'games_werewolf_ai_prompt',
    'games_undercover_prompt_presets_migrated', 'games_poker_ai_chat_enabled',
    'dock-apps', 'mofo_generators', 'mofo_deleted_item_ids',
    'phone-font-scale', 'offline-wechat-prompt-enabled',
  ];

  const wrongChat = sessionKeys.filter(k => !storage._isChatData(k));
  const wrongGlobal = globalKeys.filter(k => storage._isChatData(k));

  ok('会话状态键全部路由到 chatMetadata', wrongChat.length === 0, wrongChat.join(','));
  ok('全局配置键未被误判为会话数据', wrongGlobal.length === 0, wrongGlobal.join(','));
}

// ========== 3. App 路由与注册一致性（沿用 audit 口径，补充反向校验） ==========
{
  const appsJs = fs.readFileSync(path.join(root, 'config/apps.js'), 'utf8');
  const idx = routeSurface(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), readRepoTable());
  const apps = [...appsJs.matchAll(/id: '([a-zA-Z0-9]+)'/g)].map(m => m[1]);
  const routes = [...idx.matchAll(/appId === '([a-zA-Z0-9]+)'/g)].map(m => m[1]);
  const missing = apps.filter(a => !routes.includes(a));
  ok('每个桌面 App 都有路由分支', missing.length === 0, `缺: ${missing.join(',')}`);
  ok('APPS 无重复 id', new Set(apps).size === apps.length);
}

// ========== 4. 版本跨源自洽（不硬编码具体版本号，避免每次发布都要改测试） ==========
{
  const idxSrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const log = JSON.parse(fs.readFileSync(path.join(root, 'update-log.json'), 'utf8'));

  const codeVer = (idxSrc.match(/const ST_PHONE_VERSION = '([^']+)'/) || [])[1] || '';
  const mfVer = String(manifest.version || '');
  const latest = String(log.latest || '');

  ok('入口版本常量存在', codeVer.length > 0);
  ok('入口 ST_PHONE_VERSION == manifest.version', codeVer === mfVer, `code=${codeVer} manifest=${mfVer}`);
  ok('update-log latest == manifest.version', latest === mfVer, `latest=${latest} manifest=${mfVer}`);
  ok('update-log 含当前版本条目', !!(log.versions || {})[mfVer], mfVer);
  const cur = (log.versions || {})[mfVer];
  ok('当前版本条目有非空 items', !!(cur && Array.isArray(cur.items) && cur.items.length));
  // 内置离线公告的 version 引用版本常量，确保不会再次长期落后
  ok('内置公告引用版本常量', idxSrc.includes('ST_PHONE_CURRENT_UPDATE')
    && /const ST_PHONE_CURRENT_UPDATE = \{\s*\n?\s*version: ST_PHONE_VERSION,/.test(idxSrc));
}

// ========== 5. 存储熔断行为（回归门：本轮新增，防止被改回统一 slice(-N)） ==========
{
  const { PhoneStorage } = await import('../config/storage.js');
  const storage = new PhoneStorage();
  const ceiling = PhoneStorage.ARRAY_CEILING;
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

  // 未超限不得介入（原对象透传）
  ok('未超限数组不被改动', storage._sanitizeChatData('ruby_xhs_notes', mk(ceiling - 1)) !== undefined
    && storage._sanitizeChatData('ruby_xhs_notes', mk(ceiling - 1)).length === ceiling - 1);

  // unshift 语义键：新在头部 → 必须保留头部（错用 slice(-N) 会删掉最新内容）
  const newestFirstKey = PhoneStorage.NEWEST_FIRST_KEYS[0].source.replace(/^\^|\$$/g, '');
  const trimmedHead = storage._sanitizeChatData('ruby_xhs_notes', mk(ceiling + 200));
  ok('unshift 键保留最新(头部)', trimmedHead[0].id === 0 && trimmedHead.length === ceiling,
    `first=${trimmedHead[0]?.id} len=${trimmedHead.length}`);

  // push 语义键：新在尾部 → 必须保留尾部
  const trimmedTail = storage._sanitizeChatData('wechat_contacts', mk(ceiling + 200));
  ok('push 键保留最新(尾部)', trimmedTail[trimmedTail.length - 1].id === ceiling + 199
    && trimmedTail.length === ceiling, `last=${trimmedTail[trimmedTail.length - 1]?.id}`);
  // NEWEST_FIRST_KEYS 必须真为正则且可测试
  ok('NEWEST_FIRST_KEYS 全为正则', PhoneStorage.NEWEST_FIRST_KEYS.every(r => r instanceof RegExp));
  ok(`unshift 键表非空 (${newestFirstKey})`, PhoneStorage.NEWEST_FIRST_KEYS.length > 0);

  // 反假接线门：键表不得收录「非顶层数组」存储的键。
  // 这些键以 JSON.stringify 字符串或对象写入，数组分支对它们永不生效，
  // 收录进去只会形成「看似有防护、实为零引用」的假接线（本轮审计已踩过一次）。
  {
    const storageSrc = fs.readFileSync(path.join(root, 'config/storage.js'), 'utf8');
    const appSrc = ['apps/xhs/xhs-data.js', 'apps/tieba/tieba-data.js',
      'apps/weibo/weibo-data.js', 'apps/bilibili/bili-data.js', 'apps/theater/theater-data.js']
      .map(f => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : ''))
      .join('\n');
    // 记录已知以字符串/对象存储的键，防止被重新塞进 NEWEST_FIRST_KEYS
    const NOT_BARE_ARRAY = ['weibo_user_posts', 'weibo_hot_searches', 'bili_entries_v1', 'theater_stories_v1'];
    const listed = storageSrc.slice(
      storageSrc.indexOf('static NEWEST_FIRST_KEYS'),
      storageSrc.indexOf('];', storageSrc.indexOf('static NEWEST_FIRST_KEYS')),
    );
    const falselyListed = NOT_BARE_ARRAY.filter(k => listed.includes(k));
    ok('方向表未收录非数组存储键（反假接线）', falselyListed.length === 0, falselyListed.join(','));
    // 表内每个键都必须真的能在生产端找到裸数组写入
    const bareArrayProducers = ['ruby_xhs_notes', 'ruby_tieba_posts'];
    const missingProducer = bareArrayProducers.filter(k => !appSrc.includes(k));
    ok('裸数组键在生产端存在', missingProducer.length === 0, missingProducer.join(','));
  }


  // 记忆库以 JSON 字符串存储，不得被数组熔断误伤
  const memStr = JSON.stringify({ longTerm: mk(9999) });
  ok('JSON 字符串形态的记忆库不被裁剪', storage._sanitizeChatData('memory_core_v1', memStr) === memStr);

  // 超大 Base64 图片拒写；小图与非图片长文本放行
  ok('超大 data:image 被拒写',
    storage._sanitizeChatData('diary_entries', 'data:image/png;base64,' + 'A'.repeat(PhoneStorage.BASE64_IMAGE_CEILING + 1))
    === '[BLOCKED_LARGE_BASE64_IMAGE]');
  ok('小 data URL 放行',
    storage._sanitizeChatData('diary_entries', 'data:image/png;base64,AAAA') === 'data:image/png;base64,AAAA');
  const longText = '剧情'.repeat(60000);
  ok('非图片长文本不被误拦', storage._sanitizeChatData('ruby_xhs_notes', longText) === longText);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);