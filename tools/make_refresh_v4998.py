#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_refresh_v4998.py — 从 tools/refresh_baselines_v4995.py 逐字派生 v4998 版。

派生方式：整文件复制 + 只改 VER 常量 + 在 REFRESH_NOTE_FMT 末尾追加本版来由一条。
刷新逻辑一字未改 —— 改逻辑等于让「零手抄对账」这件事有两份实现。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
NL = chr(10)
SRC = ROOT + '/tools/refresh_baselines_v4995.py'
DST = ROOT + '/tools/refresh_baselines_v4998.py'

VER_OLD = "VER = '4.99.5'"
VER_NEW = "VER = '4.99.8'"

Q = chr(39)          # 单引号
BR_L = chr(0x3010)   # 【
BR_R = chr(0x3011)   # 】

NOTE_BODY = (
    BR_L + 'v4.99.8' + BR_R + 'R11-X4 落地的 config/sharing-boundary.js（分享三级范围 / 五态授权 / '
    '收件人视角 / 撤回）与 config/offline-creator-bundle-pipeline.js（创作者包选择性导入计划）'
    '与 config/share-migrate-bridge.js（翻形状的纯函数层）三件进 config/ 扫描根，'
    'tests/system-v4998.test.mjs 进 tests/ 面，于是三张取证基线的**枚举面**读数必然跟着涨'
    '（files_scanned 624→625 / 624→625 / 625→626，看各探针的扫描根口径）。'
    '这是「输入面变了、读数跟着变」的显式动作，不是转写漂移。'
    '其余改动（apps/backupdesk/ 三件被改、config/storage.js 的 share_ 前缀模式、'
    'scripts/keys-audit.mjs 登记行、index.js 装配）都是既有文件被改，不增枚举面。'
    '本版以 tools/refresh_baselines_v4998.py 再刷一次（同纪律：零手抄、幂等、'
    '冻结 measured_at、冻结面跳过、名单不一致即报错）。'
)

# 末条 note 的收尾形态：`……报错）。'` 换行，紧接着 `)` 换行（REFRESH_NOTE_FMT 结束）
ANCHOR = '报错）。' + Q + NL + ')' + NL


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def main():
    src = rd(SRC)
    n = src.count(VER_OLD)
    assert n == 1, ('VER anchor', n)
    out = src.replace(VER_OLD, VER_NEW, 1)
    if 'refresh_baselines_v4998.py' in out:
        print('[make] 已是本版派生，跳过')
        return 0
    m = out.count(ANCHOR)
    assert m == 1, ('NOTE anchor', m)
    # 在末条 note 之后、`)` 之前插入一条独立相邻字符串常量行（Python 相邻字面量自动拼接）
    add = '    ' + Q + NOTE_BODY + Q + NL
    out = out.replace(ANCHOR, '报错）。' + Q + NL + add + ')' + NL, 1)
    wr(DST, out)
    print('[make] 写出 %s（%d 行）' % (DST, len(out.split(NL))))
    return 0


if __name__ == '__main__':
    sys.exit(main())