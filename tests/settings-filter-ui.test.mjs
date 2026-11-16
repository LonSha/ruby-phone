import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'apps/settings/settings-app.js'), 'utf8');

const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('设置搜索具备状态、清空和 Esc 恢复路径', () => {
  assert.match(src, /id = 'r22-settings-filter-status'/, '缺少搜索结果状态节点');
  assert.match(src, /id = 'r22-settings-filter-clear'/, '缺少清空按钮');
  assert.match(src, /role', 'status'/, '结果状态必须是 status 语义');
  assert.match(src, /_r22Search\.addEventListener\('keydown'/, '缺少 Esc 键处理');
  assert.match(src, /_r22Search\.value = ''; applyFilter\(\)/, 'Esc/清空必须真正重置过滤器');
});

test('设置搜索不绕过唯一过滤器，并收起空分组', () => {
  assert.match(src, /_r22FilterSettings\(_r22Sections, _r22Search\.value\)/, '必须继续使用 settings-filter 唯一计算源');
  assert.match(code, /_r22Containers\.forEach\(\(el\) =>/, '必须遍历设置容器');
  assert.match(code, /!el\.querySelector\('\.setting-item:not\(\[hidden\]\)'\)/, '空分组必须隐藏');
  assert.match(src, /settingsFilterNote\(r\)/, '结果状态必须使用统一文案函数');
});

test('设置搜索输入与清空控件有可访问名称', () => {
  assert.match(src, /_r22Search\.setAttribute\('aria-label', '搜索设置'\)/);
  assert.match(src, /_r22SearchClear\.setAttribute\('aria-label', '清空设置搜索'\)/);
  assert.match(src, /wrap\.setAttribute\('role', 'search'\)/);
});
