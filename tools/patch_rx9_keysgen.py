#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R-X9 地基补丁 ①：keys 门抽键口径放开连字符 + 登记 142 个此前在射程外的键。

【为什么这是地基】实测（tools/probe_rx9_keys.py 与 /tmp/rx9_hyph_scope.js）：
  CALL_RE 的字符集是 `[A-Za-z_][A-Za-z0-9_]*`，而本仓有 142 个键名带**连字符**
  （phone-font-scale / phone-image-* / offline-* / story-* 等）。它们从未进入
  K1/K2/K3 的射程 —— 其中 3 个（pending-contacts / story-current-time /
  story-initial-time）**真的命中 CHAT_DATA_PATTERNS**，即「该隔离的键从未被
  任何门禁问过归属」。这正是本仓最贵的形态：不报错、不崩溃、只错数据。
"""
import io
import os
import re
import sys

ROOT = '/home/user/ruby-phone'
KEYS = os.path.join(ROOT, 'scripts/keys-audit.mjs')

src = io.open(KEYS, encoding='utf-8').read()

OLD_CALL_RE = ("const CALL_RE = new RegExp(HANDLE + String.raw`\\??\\.(?:set|get|remove)\\??\\.?"
               "\\s*\\(\\s*['\"\\`]([A-Za-z_][A-Za-z0-9_]*)['\"\\`]`, 'g');")
NEW_CALL_RE = ("/* [v3.93.0 · R-X9] 键名字符集**必须含连字符**：本仓实测 142 个键带连字符\n"
               " *   （phone-font-scale / phone-image-* / offline-* / story-* …），旧口径\n"
               " *   `[A-Za-z_][A-Za-z0-9_]*` 把它们整体挡在 K1/K2/K3 之外 —— 其中 3 个真的\n"
               " *   命中 CHAT_DATA_PATTERNS（pending-contacts / story-current-time /\n"
               " *   story-initial-time），即「该隔离的键从未被问过归属」。这不是放宽判据，\n"
               " *   是把**射程**补回它本来该有的宽度（键是 storage 的实参，字符串里有什么字符\n"
               " *   就该认什么字符）。\n"
               " *   仍刻意不收模板插值键（`phone-tts-${provider}-voice`）：它不是一个键，\n"
               " *   是一个键族，登记它等于登记一个通配 —— 归属不可知正是 v2.69.0 要治的形态。 */\n"
               "const CALL_RE = new RegExp(HANDLE + String.raw`\\??\\.(?:set|get|remove)\\??\\.?"
               "\\s*\\(\\s*['\"\\`]([A-Za-z_][A-Za-z0-9_.-]*)['\"\\`]`, 'g');")

n = src.count(OLD_CALL_RE)
if n != 1:
    print('FAIL CALL_RE 锚点命中 %d 次（要求恰中 1 次）' % n)
    sys.exit(1)
src = src.replace(OLD_CALL_RE, NEW_CALL_RE)

# ---------- 登记 142 个键 ----------
CHAT = ['pending-contacts', 'story-current-time', 'story-initial-time']

GROUPS = [
    ('offline-', '离线回复相关设置（设置页写 / 数据层读）'),
    ('phone-image-', '生图通道配置（设置页 / image-generation-manager / 各 App 读写）'),
    ('phone-tts-', '语音合成配置（设置页 / tts-manager / honey 等读写）'),
    ('phone-asr-', '语音输入配置（设置页 / asr-manager）'),
    ('phone-settings-', '设置页分组展开态（本机 UI 状态）'),
    ('phone-update-', '更新检查游标（phone/update-checker.js）'),
    ('phone-call-', '通话相关设置'),
    ('phone-honey-', '蜜语相关设置'),
    ('phone-prompt-', '提示词预设（config/prompt-manager.js）'),
    ('wechat-', '微信相关设置（设置页 / chat-view 读写）'),
]

SPECIAL = {
    'dock-apps': '底部快捷栏 App 列表（设置页写 / 桌面读）',
    'phone-app-custom-names': 'App 显示名自定义（设置页写 / 桌面读）',
    'phone-card-time-image': '时间卡片背景图路径（相册 / 设置页 / 上传器读写）',
    'phone-font-scale': '全局字体缩放百分比（设置页 / font-scale 读写）',
    'phone-frame-color': '手机壳颜色（设置页 / font-scale 读写）',
    'phone-global-text': '全局文字颜色（设置页 / font-scale 读写）',
    'phone-home-layout': '桌面布局（图标 / 卡片；设置页写 / 桌面与外壳读）',
    'phone-injection-require-variable-enabled': '注入要求变量开关（设置页写 / index.js 读）',
    'phone-prompts': '提示词总表（设置页 / prompt-manager 读写）',
    'phone-shell-scale': '外壳缩放百分比（旧键；与 sys_shell_scale 双写，控制中心与设置页读）',
    'phone-sms-limit': '短信条数上限（设置页 / phone-view 读写）',
    'phone-user-message-listener-enabled': '监听用户消息开关（设置页写 / index.js 读）',
    'phone-wallpaper': '桌面壁纸（相册 / 设置页 / 桌面 / 外壳读写）',
    'phone-wechat-offline-clean-user-reply-enabled': '微信离线清理用户回复开关（设置页 / chat-view / index.js 读写）',
}


def note_of(key):
    if key in SPECIAL:
        return SPECIAL[key]
    for pre, txt in GROUPS:
        if key.startswith(pre):
            return txt
    return '显示与交互设置（本机外观，跨会话共享）'


def entry(key, scope):
    return "  { key: '%s', scope: '%s', note: '%s' }" % (key, scope, note_of(key))


lines = []
lines.append("""
  // ══ [v3.93.0 · R-X9] 键名字符集放开后**补齐的登记**（142 条）══
  // 为什么现在才有：旧抽取口径的字符集是 `[A-Za-z_][A-Za-z0-9_]*`，把 142 个带连字符的
  //   键整体挡在 K1/K2/K3 之外（实测），其中 3 个真的命中 CHAT_DATA_PATTERNS。
  // 逐键显式枚举、不用通配（如 `phone-*`）：通配会把「新键归属」重新变成不需要回答的问题
  //   —— 那正是 v2.69.0 把 `/^ruby_/` 兜底改成逐键枚举的理由。
  // 归属判据是**实测**：对每个键跑一遍 CHAT_DATA_PATTERNS，命中即 chat、不命中即 global。\
""")
for k in CHAT:
    lines.append(entry(k, 'chat') + ',')
for k in ['dock-apps']:
    pass
# 其余全部 global（含 SPECIAL 里出现的）
others = []
import json
data = json.loads(io.open('/tmp/rx9_keysim.json', encoding='utf-8').read())
for k in data['unregGlobal']:
    others.append(k)
for k in others:
    lines.append(entry(k, 'global') + ',')
# 去掉最后一行逗号
lines[-1] = lines[-1][:-1]
block = '\n'.join(lines) + '\n'

ANCHOR = "  { key: '__migration_ledger', scope: 'global', note: '存储层迁移留痕账本（version+keys）' }\n];"
if src.count(ANCHOR) != 1:
    print('FAIL KEY_REGISTRY 尾部锚点命中 %d 次' % src.count(ANCHOR))
    sys.exit(1)
src = src.replace(ANCHOR,
                  "  { key: '__migration_ledger', scope: 'global', note: '存储层迁移留痕账本（version+keys）' },\n"
                  + block + "];")

io.open(KEYS, 'w', encoding='utf-8').write(src)
print('OK keys-audit.mjs %d 字节 · 登记 3 chat + %d global' % (len(src), len(others)))
