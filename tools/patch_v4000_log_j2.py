#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.00.0] 台账回写：注册板动作改名 readAll + 动作数从四改六（如实）。"""
import io, sys

p = '/home/user/ruby-phone/update-log.json'
s = io.open(p, encoding='utf-8').read()

pairs = [
    ('window.VirtualPhone.mediaTasks 四个动作：upsert（过 normalizeTask 窄口 + **迁移守卫**：旧态→新态必须过白名单，cancelled 是终态、playable 不许回 running）、remove、cancel（走 canCancel/applyCancel）、snapshot（聚合读数）；另加 shouldSkip（在飞拦截）与 selfCheck（内核自检）。',
     'window.VirtualPhone.mediaTasks 六个动作：upsert（过 normalizeTask 窄口 + **迁移守卫**：旧态→新态必须过白名单，cancelled 是终态、playable 不许回 running）、remove、cancel（走 canCancel/applyCancel）、readAll（聚合读数）、shouldSkip（在飞拦截）、selfCheck（内核自检）。**该动作原名 snapshot()，本版改名**：上游 lonsha 桥是推送型，它的 `snapshot` 是**对象字段**，本板动作与桥字段同名（且产品面出现 `.snapshot(` 调用式）会被第九道门 bridge-contract 的 J2 判据打红 —— 而那条判据钉的正是本仓记录过的真缺陷（把推送型桥的 snapshot 对象当函数 call，必然抛 TypeError 并被 catch 吞掉，App 永久显示「桥在但没快照」）。**一句话：动作名与桥字段名必须分得开**。'),
    ('在 TAG 阶段点取消，abort 已置位而 TAG 请求抛错会走 TAG 的 catch，把消息写成 failed 并弹「英文 TAG 生成失败」',
     '在 TAG 阶段点取消，abort 已置位而 TAG 请求抛错会走 TAG 的 catch，把消息写成 failed 并弹「英文 TAG 生成失败」'),
    ('修法：TAG 的 catch 开头加同一道 abort 守卫（两段',
     '修法：TAG 的 catch 开头加同一道 abort 守卫（两段'),
]

hit = 0
for old, new in pairs:
    n = s.count(old)
    if n != 1:
        print('SKIP(%d) %r' % (n, old[:60]))
        continue
    s = s.replace(old, new)
    hit += 1

io.open(p, 'w', encoding='utf-8').write(s)
import json
json.load(io.open(p, encoding='utf-8'))
print('log patch hit=%d JSON OK' % hit)
