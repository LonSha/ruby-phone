# -*- coding: utf-8 -*-
"""[v3.34.0] 把 lofter-data.js 的内置作者池从 6 位扩到 8 位。

理由（不是**凑数**，是补齐一处**结构性缺口**）：
  源 `LOFTER_ACTIVE_TYPES` 只认 4 类（fan_writer / fan_artist / cp_fan / info_station），
  其余 3 类在源里是**静默过滤**掉的 —— 本仓不许静默，所以非活跃类型必须**在池里真实存在**，
  由 `isActiveLofterType` 显式滤掉并在读数里如实计数。
  6 位原池全是活跃类型 ⇒ `isActiveLofterType` 永远返回 true，
  这个函数的判别力是**零**（负向假绿三形里的第二形）。
  补两位非活跃作者（`oc_creator` / `reviewer`）后：活跃 6 / 非活跃 2，
  函数开始有真实判别力，且源的「7 类取 4 类」被如实复现。

替换方式：按声明行起、按首个 `^];` 止（不按行号硬编码，抗上方行数漂移）。
"""
import ast
import sys

PATH = 'apps/lofter/lofter-data.js'

NEW_BLOCK = """export const LOFTER_BUILT_IN_AUTHORS = [
    { id: 'lof_a_shenmo', name: '沈墨不写字', handle: 'shenmo_nw', type: 'fan_writer', bio: '只写刀、不写糖。', contentTags: ['宿命', '错过', '群像'], writingStyle: '克制、短句收束', followerCount: 12800 },
    { id: 'lof_a_guqing', name: '顾青梧', handle: 'qingwu_draw', type: 'fan_artist', bio: '画手的笔比嘴诚实。', contentTags: ['构图', '光影', '双人'], followerCount: 24300 },
    { id: 'lof_a_wenning', name: '温宁睡不着', handle: 'wenning_zzz', type: 'cp_fan', bio: '抠糖使我快乐。', contentTags: ['抠糖', '安利', '粮单'], followerCount: 8600 },
    { id: 'lof_a_ayin', name: '阿萦情报站', handle: 'ayin_station', type: 'info_station', bio: '只搬运、不加工。', contentTags: ['考据', '设定', '情报'], followerCount: 31500 },
    { id: 'lof_a_qian', name: '祁岸', handle: 'qian_an', type: 'fan_writer', bio: '正剧控，节奏慢。', contentTags: ['权谋', '群像', '正剧'], writingStyle: '文白相间、留白多', followerCount: 9700 },
    { id: 'lof_a_teng', name: '傅棹', handle: 'fuzhao_', type: 'fan_writer', bio: '写些没头没尾的日常。', contentTags: ['日常', '治愈', '对白'], writingStyle: '对白驱动、短句明快', followerCount: 15200 },
    // ↓ 两位**非活跃类型**：源 `LOFTER_ACTIVE_TYPES` 只认 4 类，`oc_creator`（原创角色）与
    //   `reviewer`（长评）在源里被静默过滤。本仓把它们**留在池里**，由 `isActiveLofterType`
    //   显式滤掉并在读数里如实计数 —— 静默过滤是源的一处脏，本仓不许再有第二个静默。
    //   （它们还让 `isActiveLofterType` 从「永真」变成有判别力的函数。）
    { id: 'lof_a_yanci', name: '砚池', handle: 'yanchi_oc', type: 'oc_creator', bio: '只养自家的孩子。', contentTags: ['原创', '设子', '主创'], followerCount: 4300 },
    { id: 'lof_a_jshen', name: '江慎', handle: 'jshen_review', type: 'reviewer', bio: '读完才说话。', contentTags: ['长评', '拆解', '文评'], followerCount: 6100 },
];"""


def main() -> int:
    with open(PATH, encoding='utf-8') as f:
        lines = f.readlines()
    start = None
    for i, ln in enumerate(lines):
        if ln.startswith('export const LOFTER_BUILT_IN_AUTHORS = ['):
            start = i
            break
    if start is None:
        print('FAIL: 未找到 LOFTER_BUILT_IN_AUTHORS 声明行')
        return 1
    end = None
    for j in range(start + 1, len(lines)):
        if lines[j].rstrip('\n') == '];':
            end = j
            break
    if end is None:
        print('FAIL: 未找到闭合行 `];`')
        return 1
    old_n = end - start + 1
    new_lines = [NEW_BLOCK + '\n']
    lines[start:end + 1] = new_lines
    with open(PATH, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print('替换行区间: %d..%d（%d 行 → 1 行）' % (start + 1, end + 1, old_n))
    return 0


if __name__ == '__main__':
    sys.exit(main())
