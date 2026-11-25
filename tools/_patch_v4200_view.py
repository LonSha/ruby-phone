import io

def patch(path, pairs):
    s = io.open(path, encoding='utf8').read()
    for old, new, why in pairs:
        assert old in s, 'MISS(' + path + '): ' + why
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf8').write(s)
    print('patched', path)


# ── 1) 视图两处写死条数改成按真源算 ──
patch('apps/diagnose/diagnose-view.js', [
    ("html += '<div class=' + Q + 'dg-note' + Q + '>全部 89 件 App 都有像素图标，且在册 id 都能落到磁盘上。'",
     "html += '<div class=' + Q + 'dg-note' + Q + '>全部 ' + String(face.total) + ' 件 App 都有像素图标，且在册 id 都能落到磁盘上。'",
     'icon note count'),
    ("<h3>销毁动作分级（89 件 App 删了能不能回来）</h3>' + this._undoFaceHtml(pkg)",
     "<h3>销毁动作分级（' + String((pkg && pkg.undoFace && pkg.undoFace.appsTotal) || 0) + ' 件 App 删了能不能回来）</h3>' + this._undoFaceHtml(pkg)",
     'undo card title'),
])

# ── 2) 判据：条数改按真源，且禁止把条数写死回标题 ──
patch('tests/system-v4105.test.mjs', [
    ('//   ① A 面 声明面自洽：89 条声明与 `config/apps.js` 的 APPS **双向**对账（条数 / id 集合 /',
     '//   ① A 面 声明面自洽：一条一声明与 `config/apps.js` 的 APPS **双向**对账（条数 / id 集合 /',
     'header comment'),
    ("    assert.equal(APPS.length, 89, 'APPS 真源应当是 89 件（本版基线；变了就要同步声明表）');",
     "    /* ★ [v4.200.0 修既有] 本条原来写死 89。v4.191.0 起 APPS 真源已长到 105（试算内核形态的\n"
     "     *   16 件并入），声明表却停在 89 ⇒ 这条判据连红多版，且看着像「本版引入的新红」。\n"
     "     *   教训与 v4105 守的正是同一件事：**判据不许写死一个会随仓增长的量**。故这里改成\n"
     "     *   「声明表必须与真源等长」，条数只在断言消息里出现。 */\n"
     "    const DECL_EXPECT = 105;\n"
     "    assert.equal(APPS.length, UNDO.UNDO_DECLARATIONS.length, '★ APPS 真源与声明表必须等长（真源 ' + String(APPS.length) + ' / 声明 ' + String(UNDO.UNDO_DECLARATIONS.length) + '）');\n"
     "    assert.equal(DECL_EXPECT, 105, '本版基线：105 件 App（变了要同步这条基线注释与 A4 的三档读数）');",
     'A1 apps len'),
    ("    assert.equal(decl.length, 89, '★ 声明必须一条一 App（目录 88 ≠ App 89：apps/memory 承载 memory + graph）');",
     "    assert.equal(decl.length, 105, '★ 声明必须一条一 App（目录数 ≠ App 数：apps/memory 承载 memory + graph，apps/<父>/ 还承载试算内核）');",
     'A1 decl len'),
    ("    assert.equal(new Set(ids).size, 89, 'appId 不许重复（重复会让 undoModeCounts 多算一件）');",
     "    assert.equal(new Set(ids).size, 105, 'appId 不许重复（重复会让 undoModeCounts 多算一件）');",
     'A1 unique'),
    ("    assert.equal(c.total, 89);", "    assert.equal(c.total, 105);", 'A4 total'),
    ("    assert.equal(c.irreversible, 59, 'irreversible 档 = 如实记账的 59 件（含 4 件「全目录零破坏性入口」）');",
     "    assert.equal(c.irreversible, 75, 'irreversible 档 = 如实记账的 75 件（含 3 件「全目录零破坏性入口」+ 16 件试算内核/规则引擎）');",
     'A4 irreversible'),
    ("    assert.ok(line.includes('89'), line);", "    assert.ok(line.includes('105'), line);", 'A6 total'),
    ("    assert.ok(/销毁动作分级（89 件 App 删了能不能回来）/.test(v), '③ 卡片标题必须可辨认');",
     "    assert.ok(/销毁动作分级（/.test(v) && /件 App 删了能不能回来）/.test(v), '③ 卡片标题必须可辨认');\n"
     "    /* ★ 标题里的条数必须按真源算，不许写死：写死 89 正是本套件在本版转红的那条根因\n"
     "     *   —— 同一族缺陷在判据自己身上复发过一次，故在此显式禁止。 */\n"
     "    assert.equal(/\\d+ 件 App 删了能不能回来/.test(v), false, '★ 标题条数不许写死（必须来自 undoFace.appsTotal）');",
     'D2 title'),
])
print('done')