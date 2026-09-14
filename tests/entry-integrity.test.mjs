// RubyPhone 入口完整性 + 存储路由回归门
// [v2.8.10 审计修复] 本测试用于防止两类已发生过的真实缺陷再次漏网：
//   P0-1 入口 index.js 语法损坏（曾连续 9 个版本无法加载，却 75 个测试全绿）
//   P0-2 会话状态键被误判为全局配置（跨会话串味）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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
  const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const apps = [...appsJs.matchAll(/id: '([a-zA-Z0-9]+)'/g)].map(m => m[1]);
  const routes = [...idx.matchAll(/appId === '([a-zA-Z0-9]+)'/g)].map(m => m[1]);
  const missing = apps.filter(a => !routes.includes(a));
  ok('每个桌面 App 都有路由分支', missing.length === 0, `缺: ${missing.join(',')}`);
  ok('APPS 无重复 id', new Set(apps).size === apps.length);
}

// ========== 4. 版本一致性 ==========
{
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  ok('manifest 版本为 2.8.10', manifest.version === '2.8.10', manifest.version);
  const changelog = fs.readFileSync(path.join(root, 'update-log.json'), 'utf8');
  ok('update-log 记录 2.8.10', changelog.includes('2.8.10'));
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);