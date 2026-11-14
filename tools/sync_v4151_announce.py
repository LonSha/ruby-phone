#!/usr/bin/env python3
"""tools/sync_v4151_announce.py — 从迭代段真源同步「当版公告」到两处消费者

为什么需要（而不是手改三处）：
  本仓的当版公告有**两个消费者**：`update-log.json` 的 `versions[<ver>].items`
  与 `index.js` 的 `ST_PHONE_CURRENT_UPDATE.items`。两处必须**逐字同源**
  （判据 system-v310 的 E 面：`blk[0].includes(JSON.stringify(item))`）。
  真源是 `tools/iter270_seg.md`（抬版脚本 tools/bump_v4151.py 就是从它读 items）。

  本版全量回归抓到一条**真缺陷**：公告的「运行时验证边界」那一条只写了边界，
  却没有带上与 `docs/runtime-verification-boundary.md` **同源**的标志语
  `看起来没坏但显示不对`，于是 system-v328 的 A2/B1/D2 三条当场转红 ——
  这正是那套判据存在的理由：工程侧写了边界、用户侧另说一套，用户其实看不到边界。

  所以本脚本做的事是「改真源 → 同步两个消费者」，而不是分别手改三处：
  手改三处迟早会出现「两处对、一处旧」，而判据只守「两处逐字相同」，
  不会告诉你「两处一起错」。真源同步之后，三处不可能漂移。

  ★ 不重新分配版本、不动任何版本号：只重写当版的 items。抬版仍归 bump_v4151.py。
"""
import io
import json
import sys

SEG = 'tools/iter270_seg.md'
UL = 'update-log.json'
IDX = 'index.js'
VER = '4.150.0'
NL = '\n'
START = 'const ST_PHONE_CURRENT_UPDATE = {'


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def wr(p, s):
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def parse_items(seg_path):
    """从迭代段里抽 `- 【…】…` 条目（与 bump_v4151.py 同一口径，不另立一份）。"""
    seg = rd(seg_path)
    items = []
    for line in seg.split(NL):
        s = line.strip()
        if s.startswith('- '):
            body = s[2:].strip()
            if body.startswith('\u3010'):
                items.append(body)
    assert items, 'iter seg 里一条 `- 【…】` 条目都没抽到（真源解析失败，不静默继续）'
    assert any(it.startswith('\u3010\u7248\u672c\u5347\u81f3') for it in items), \
        'iter seg 必须含收尾条目「【版本升至 …】」'
    return items


def main():
    items = parse_items(SEG)
    print('[sync] 真源 %s：%d 条' % (SEG, len(items)))

    ul = json.loads(rd(UL))
    assert VER in ul['versions'], 'update-log 里没有当版 ' + VER
    old = ul['versions'][VER]['items']
    if old == items:
        print('[sync] update-log 已是同源，跳过重写')
    else:
        ul['versions'][VER]['items'] = items
        wr(UL, json.dumps(ul, ensure_ascii=False, indent=2) + NL)
        print('[sync] update-log.json 重写：%d 条 -> %d 条' % (len(old), len(items)))

    ij = rd(IDX)
    bi = ij.index(START)
    bj = ij.index(NL + '};', bi)
    old_block = ij[bi:bj]
    date = ul['versions'][VER]['date']
    head = (START + NL + '    version: ST_PHONE_VERSION,' + NL
            + '    date: ' + json.dumps(date) + ',' + NL + '    items: [')
    lines = [head]
    for i, it in enumerate(items):
        comma = ',' if i < len(items) - 1 else ''
        lines.append('        ' + json.dumps(it, ensure_ascii=False) + comma)
    lines.append('    ]')
    new_block = NL.join(lines)
    ij = ij[:bi] + new_block + ij[bj:]
    wr(IDX, ij)
    print('[sync] index.js 公告块重写：%d -> %d 字符' % (len(old_block), len(new_block)))

    # 同源自检：两处必须逐字包含每一条（这正是 system-v310 E 面在守的形态）
    ul2 = json.loads(rd(UL))
    ij2 = rd(IDX)
    blk = ij2[ij2.index(START):ij2.index(NL + '};', ij2.index(START))]
    for it in items:
        assert json.dumps(it, ensure_ascii=False) in blk, 'index.js 公告块缺条目：' + it[:30]
    assert ul2['versions'][VER]['items'] == items, 'update-log 与真源不同源'
    print('[sync] 同源自检通过：update-log 与 index.js 公告块逐字一致（%d 条）' % len(items))
    return 0


if __name__ == '__main__':
    sys.exit(main())