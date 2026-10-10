# -*- coding: utf-8 -*-
"""干跑 patch_rx8_diag.py 的锚点计数（不写文件），并核对两处已知问题。"""
import importlib.util
import io
import sys

ROOT = '/home/user/ruby-phone'
spec = importlib.util.spec_from_file_location('rx8diag', ROOT + '/tools/patch_rx8_diag.py')
m = importlib.util.module_from_spec(spec)
sys.modules['rx8diag'] = m
spec.loader.exec_module(m)   # 只定义常量；main 不跑


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


data = read(m.DATA)
view = read(m.VIEW)

print('--- data ---')
for a, b, name in [(m.IMP_OLD, m.IMP_NEW, 'import'), (m.FACE_OLD, m.FACE_NEW, 'face'),
                   (m.RET_OLD, m.RET_NEW, 'return-list'), (m.TXT_OLD, m.TXT_NEW, 'text-fn'),
                   (m.DEF_OLD, m.DEF_NEW, 'default-export')]:
    print(name, data.count(a))
print('--- view ---')
for a, b, name in [(m.VIMP_OLD, m.VIMP_NEW, 'import'), (m.CARD_OLD, m.CARD_NEW, 'card'),
                   (m.SEC_OLD, m.SEC_NEW, 'section')]:
    print(name, view.count(a))

print('--- 问题核对 ---')
print('data 里 crossrepo-caphealth-link 出现次数:', data.count('crossrepo-caphealth-link'))
print('data 里 capability-health 出现次数:', data.count('capability-health'))
print('view 里 symOfState 定义次数:', view.count('function symOfState'))
print('view 里 symOfState 总出现:', view.count('symOfState'))
print('data 里 numOrNull 用法:', data.count('numOrNull('))
print('CARD_NEW 里 symOfState:', m.CARD_NEW.count('symOfState'))
print('IMP_NEW 里 crossrepo-caphealth-link:', m.IMP_NEW.count('crossrepo-caphealth-link'))
