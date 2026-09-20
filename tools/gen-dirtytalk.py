#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""撩语语料库生成器 [v2.48.0]
源：ST 聊骚语料世界书 v9.2.7（673 条 / 71.3 万字，key 全为精确方括号绿灯标签）
用法：python3 tools/gen-dirtytalk.py [源.json]
默认源：.sourcematerial/Adult_Romance_DirtyTalk_WorldInfo_v927.json
产出（同源三件套）：
  data/dirtytalk.js        全量正文模块（撩语 App 装配与注入）
  data/dirtytalk-index.js  轻量索引 + 元数据（tier/cat/styles/前缀契约）
  data/dirtytalk-corpus.js 原始语料档（只读参考，不注入）
归并规则：
  style  : DT_STYLE（8 风格，路由+v8.2 执行器同 key 拼合，force=0）
  hum    : HUM_METHOD + OTHER 旧 key，按方法名（去编号）归并，force=1
  play   : PLAY_TYPE/PLAY_TAG/PLAY_MODE/PLAY_STRUCT/PLAY_CLASS/ACTION_PACK/ACTION_ATOM
  quote  : QUOTE_BANK
  corpus : CC0_RAW/CORPUS_*/CN_BANTER*/VOICE_SLICE/REF_*_ARCHIVE/LOCKED_WI_ENTRY/
           LEGACY_TASK/DTX_FRESH_ARCHIVE_FULL —— 只进语料档
  机制条 : DTX_* / LS_* / QUOTE_*(非 BANK) 控制条 —— 丢弃
tier 按归并后字数：>=1200 重 / >=600 中 / 其余 轻
"""
import json, re, sys, hashlib

SRC = sys.argv[1] if len(sys.argv) > 1 else '.sourcematerial/Adult_Romance_DirtyTalk_WorldInfo_v927.json'

CORPUS_PREFIXES = {'CC0_RAW', 'CORPUS_CC0', 'CORPUS_FLAVOR', 'CORPUS_PRESET', 'CN_BANTER',
                   'CN_BANTER_ARCHIVE', 'VOICE_SLICE', 'REF_MATERIAL_ARCHIVE', 'REF_RAW_ARCHIVE',
                   'LOCKED_WI_ENTRY', 'LEGACY_TASK', 'DTX_FRESH_ARCHIVE_FULL'}
PLAY_MAP = {'PLAY_TYPE': ('玩法类型', 1), 'PLAY_TAG': ('玩法细分', 1), 'PLAY_MODE': ('玩法模式', 1),
            'PLAY_STRUCT': ('玩法结构', 1), 'PLAY_CLASS': ('玩法分类', 1), 'ACTION_PACK': ('动作包', 1),
            'ACTION_ATOM': ('动作原子', 1), 'QUOTE_BANK': ('语录库', 1)}
TAG_RE = re.compile(r'^\[([A-Za-z_0-9]+)(?::([^\]]+))?\]$')
BARE_RE = re.compile(r'^\[([^\]:]+)\]$')
MECH_RE = re.compile(r'^(DTX_|LS_|QUOTE_(?!BANK))')


def first_tag(e):
    for k in (e.get('key') or []):
        k = k.strip()
        m = TAG_RE.match(k)
        if m:
            return m.group(1), (m.group(2) or '').strip(), k
        m = BARE_RE.match(k)
        if m:
            return 'OTHER', m.group(1).strip(), k
    return None, None, None


def tier_of(chars):
    return '重' if chars >= 1200 else ('中' if chars >= 600 else '轻')


def main():
    data = json.load(open(SRC, encoding='utf-8'))
    entries = data.get('entries') or {}
    entries = list(entries.values()) if isinstance(entries, dict) else entries
    groups = {}
    order = []
    corpus = []
    skipped = 0
    for e in entries:
        c = e.get('content') or ''
        prefix, val, rawkey = first_tag(e)
        if not prefix or MECH_RE.match(prefix):
            skipped += 1
            continue
        if prefix in CORPUS_PREFIXES:
            corpus.append({'name': (e.get('comment') or prefix).strip(), 'prefix': prefix,
                           'chars': len(c), 'content': c})
            continue
        if prefix == 'DT_STYLE':
            cat, gid, label, force = 'style', val, '聊骚风格', 0
        elif prefix in ('HUM_METHOD', 'OTHER'):
            cat, label, force = 'hum', '反差人设', 1
            gid = re.sub(r'^\d+', '', val)  # 去编号按方法名归并
        elif prefix in PLAY_MAP:
            label, force = PLAY_MAP[prefix]
            cat = 'quote' if prefix == 'QUOTE_BANK' else 'play'
            gid = val or prefix
        else:
            skipped += 1
            continue
        if not gid:
            gid = prefix
        gk = (cat, gid)
        if gk not in groups:
            groups[gk] = {'cat': cat, 'gid': gid, 'label': label, 'force': force, 'parts': []}
            order.append(gk)
        groups[gk]['parts'].append(c)

    modules = []
    seen = set()
    for gk in order:
        g = groups[gk]
        content = '\n\n'.join(x for x in g['parts'] if x)
        chars = len(content)
        mid = 'dt_' + hashlib.md5((g['cat'] + '|' + g['gid']).encode('utf-8')).hexdigest()[:6]
        assert mid not in seen, 'duplicate id: ' + mid
        seen.add(mid)
        first = next((ln.strip() for ln in content.split('\n') if ln.strip()), '')
        modules.append({'id': mid, 'name': g['gid'], 'cat': g['cat'], 'label': g['label'],
                        'chars': chars, 'sub': len(g['parts']), 'force': g['force'],
                        'desc': first[:60], 'tier': tier_of(chars), 'content': content})

    styles = [g['gid'] for gk, g in groups.items() if g['cat'] == 'style']
    assert len(styles) == 8, 'style count = %d, expect 8' % len(styles)
    idx = [{k: m[k] for k in ('id', 'name', 'cat', 'label', 'chars', 'sub', 'force', 'tier', 'desc')}
           for m in modules]
    assert [m['id'] for m in modules] == [x['id'] for x in idx], 'index/module id order mismatch'

    def dump_js(path, header, name, rows):
        with open(path, 'w', encoding='utf-8') as f:
            f.write(header)
            f.write('export const %s = [\n' % name)
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + ',\n')
            f.write('];\n')

    dump_js('data/dirtytalk.js',
            '// [v2.48.0] 撩语·全量正文模块（由 tools/gen-dirtytalk.py 从源世界书同源生成，勿手改）\n',
            'dirtyTalkModules', modules)
    with open('data/dirtytalk-index.js', 'w', encoding='utf-8') as f:
        f.write('// [v2.48.0] 撩语·轻量索引与元数据（由 tools/gen-dirtytalk.py 同源生成，勿手改）\n')
        f.write('export const dirtyTalkIndex = ' +
                json.dumps(idx, ensure_ascii=False, separators=(',', ':')) + ';\n')
        f.write('export const DT_TIER_META = {'
                '"重":{"weight":8,"label":"重型语料","color":"#c026d3","order":0},'
                '"中":{"weight":16,"label":"标准语料","color":"#e879f9","order":1},'
                '"轻":{"weight":30,"label":"轻量语料","color":"#94a3b8","order":2}};\n')
        f.write('export const DT_TIER_ORDER = ["重","中","轻"];\n')
        f.write('export const DT_CAT_ORDER = ["style","hum","play","quote"];\n')
        f.write('export const DT_CAT_LABEL = {"style":"聊骚风格","hum":"反差人设","play":"玩法模块","quote":"语录库"};\n')
        f.write('export const DT_STYLES = ' + json.dumps(styles, ensure_ascii=False) + ';\n')
        f.write("export const DT_ITEM_PREFIX = 'dt_';\n")
        f.write('/** 模块 id 本身已带 dt_ 前缀，抽卡 itemId 与模块 id 同一真源 */\n')
        f.write('export function dtItemId(moduleId) { return String(moduleId || ""); }\n')
        f.write('/** 反解 itemId → 模块 id；非撩语 id 一律返回空串（不猜） */\n')
        f.write('export function dtModuleIdOfItem(itemId) {\n')
        f.write('  const s = String(itemId || "");\n')
        f.write('  return s.startsWith(DT_ITEM_PREFIX) ? s : "";\n')
        f.write('}\n')
    dump_js('data/dirtytalk-corpus.js',
            '// [v2.48.0] 撩语·原始语料档（只读参考，不参与注入；由 tools/gen-dirtytalk.py 生成）\n',
            'dirtyTalkCorpus', corpus)

    mod_chars = sum(m['chars'] for m in modules)
    print('OK: modules=%d (chars=%d) corpus=%d (chars=%d) skipped=%d styles=%d'
          % (len(modules), mod_chars, len(corpus), sum(c['chars'] for c in corpus), skipped, len(styles)))


if __name__ == '__main__':
    main()