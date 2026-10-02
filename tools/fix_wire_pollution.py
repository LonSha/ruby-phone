#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, subprocess, sys
ROOT = '/home/user/ruby-phone'
NL = chr(10)
WRITE = '--write' in sys.argv

WJ_NEW = """/** 接线面取数口。★ root 可指向副本树 —— 破坏类负控制只准写副本，绝不写真仓：
 *  node --test 是文件级并行，写真仓会在破坏窗口内被别的套件读到，
 *  且跑批被中断时（finally 来不及执行）会把破坏永久留在仓里。 */
function wireJudgeAt(root) {
    const rd = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
    return wireProblems({
        apps: rd(APPS), storage: rd(STORAGE), index: rd(INDEX),
        keys: rd(KEYS), phoneCss: rd(PHONE_CSS)
    });
}
function wireJudge() { return wireJudgeAt(ROOT); }
/** 接线面副本树：六处落点所在文件按真相对路径各一份。 */
function stageWire() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_wire_'));
    temps.push(dir);
    for (const rel of [APPS, STORAGE, INDEX, KEYS, PHONE_CSS]) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    return dir;
}"""

BRANCH_NEW = """        if (kind === 'wire') {
            /* ★ 只写副本：写真仓会在并行窗口里被别的套件读到，中断还会留下永久破坏。 */
            const dirW = stageWire();
            const realW = fs.readFileSync(path.join(dirW, rel), 'utf8');
            assert.deepEqual(wireJudgeAt(dirW), [], '对照：副本未破坏时必须干净');
            fs.writeFileSync(path.join(dirW, rel), damaged);
            const badW = wireJudgeAt(dirW);
            assert.ok(badW.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (badW.join(' , ') || '（没报）'));
            fs.writeFileSync(path.join(dirW, rel), realW);
            assert.deepEqual(wireJudgeAt(dirW), [], '对照：还原后副本必须干净');
            assert.deepEqual(wireJudge(), [], '对照：真接线必须干净');
            return;
        }"""

TEMPS_TAIL = """
/** 副本树登记表（跑完必删）。★ 本套件对真仓只读：破坏类负控制只准落在副本上。 */
const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});"""

READ_LINE = "const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');"

for rel in ['tests/system-v3450.test.mjs', 'tests/system-v3460.test.mjs']:
    p = os.path.join(ROOT, rel)
    s = open(p, encoding='utf-8').read()
    if 'function wireJudgeAt(' in s:
        print('[skip]', rel)
        continue
    lines = s.split(NL)
    # ① wireJudge -> wireJudgeAt + stageWire
    a = None
    for i, l in enumerate(lines):
        if l.strip() == 'function wireJudge() {':
            a = i
            break
    assert a is not None, rel + ' wireJudge'
    b = None
    for j in range(a, len(lines)):
        if lines[j].strip() == '}':
            b = j
            break
    assert b is not None, rel + ' wireJudge 尾'
    lines = lines[:a] + WJ_NEW.split(NL) + lines[b + 1:]
    # ② temps 声明
    k = None
    for i, l in enumerate(lines):
        if l == READ_LINE:
            k = i
            break
    assert k is not None, rel + ' read 行'
    lines = lines[:k + 1] + TEMPS_TAIL.split(NL) + lines[k + 1:]
    # ③ 接线分支 -> 副本
    a = None
    for i, l in enumerate(lines):
        t = l.strip()
        if t.startswith('if (kind ===') and 'wire' in t:
            a = i
            break
    assert a is not None, rel + ' wire 分支'
    b = None
    for j in range(a, len(lines)):
        if 'const dir = stageTree();' in lines[j]:
            b = j
            break
    assert b is not None, rel + ' stageTree'
    assert any('writeFileSync(path.join(ROOT' in x for x in lines[a:b]), rel + ' 旧分支锚点不对'
    lines = lines[:a] + BRANCH_NEW.split(NL) + lines[b:]
    # ④ stageTree 也登记清理
    if not any('temps.push(dir);' in x for x in lines):
        i = None
        for j, l in enumerate(lines):
            if l.startswith('function stageTree() {'):
                i = j
                break
        assert i is not None, rel + ' stageTree 定义'
        for j in range(i, len(lines)):
            if 'mkdtempSync' in lines[j]:
                lines = lines[:j + 1] + ['    temps.push(dir);'] + lines[j + 1:]
                break
    out = NL.join(lines)
    assert 'writeFileSync(path.join(ROOT' not in out, rel + ' 真仓写入未清干净'
    if WRITE:
        open(p, 'w', encoding='utf-8').write(out)
        r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
        print('[write]', rel, 'bytes', len(out.encode('utf-8')), 'syntax rc', r.returncode, r.stderr[:200])
    else:
        print('[dry]', rel)
print('OK' if WRITE else '（dry-run）')
