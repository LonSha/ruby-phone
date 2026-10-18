import io, sys

P = 'apps/workflow/workflow-design.js'
src = io.open(P, encoding='utf-8').read()

def once(anchor, label):
    n = src.count(anchor)
    if n != 1:
        print('ANCHOR-FAIL', label, n)
        sys.exit(2)

# 1 import
A1 = "} from '../../config/workflow-designer.js';"
once(A1, 'import')
NEW1 = A1 + "\nimport {\n    OP_PARAM_STATES, opFaceOptions, stepParamsOf, flowPreviewOf,\n} from '../../config/object-picker.js';"
src = src.replace(A1, NEW1, 1)

# 2 vm candidates + preview
A2 = '        const comp = composeFlow(d);'
once(A2, 'vm-comp')
NEW2 = A2 + ('\n'
  '        /* [v4.20.0 . R4-O8] 候选对象来自宿主读数(已存模板名)。读不到就传 null 下去,\n'
  '         * 让选择器亮「候选读不到」;在这里补一个空数组冒充「一个都没有」是本仓最贵的那类错。 */\n'
  '        const pickCand = { templates: (tpl.readable === false) ? null : rows.map((t) => String(t.name || \'\')) };\n'
  '        const pvw = flowPreviewOf(d, pickCand);')
src = src.replace(A2, NEW2, 1)

# 3 per-step picker rows
A3 = "                const act = WD_ACTIONS[String(s.action || '')] || null;"
once(A3, 'step-act')
NEW3 = A3 + ('\n'
  '                const sp = stepParamsOf(s, act, pickCand);\n'
  '                const fo = opFaceOptions(act ? act.in.slice() : null);\n'
  '                const pvRow = pvw.rows[i] || null;')
src = src.replace(A3, NEW3, 1)

# 4 return fields
A4 = "                    stepOwner: act ? act.owner : '',"
once(A4, 'stepOwner')
NEW4 = A4 + ('\n'
  '                    /* [v4.20.0 . R4-O8] 参数 / 条件 / 预览一律走对象选择器:\n'
  '                     * 界面只出中文名与候选项,内部键留在 data 属性里给绑定用。 */\n'
  '                    paramRows: sp.rows, paramsReadable: sp.readable,\n'
  '                    faceOptions: fo.options, previewText: pvRow ? pvRow.sentence : \'\',')
src = src.replace(A4, NEW4, 1)

# 5 vm preview fields
A5 = '            actions: actions,'
once(A5, 'actions')
NEW5 = A5 + '\n            previewText: pvw.text, previewRows: pvw.rows,'
src = src.replace(A5, NEW5, 1)

# 6 params render block (block replace by line span)
lines = src.split('\n')
start = None
for i, L in enumerate(lines):
    if L == '        if (st.paramKeys.length) {':
        start = i
        break
if start is None:
    print('BLOCK-FAIL params start')
    sys.exit(2)
end = None
for j in range(start + 1, len(lines)):
    if lines[j] == '        }':
        end = j
        break
if end is None:
    print('BLOCK-FAIL params end')
    sys.exit(2)
new_block = [
 '        if ((st.paramRows || []).length) {',
 '            /* [v4.20.0 . R4-O8] 参数行不再露内部键:中文名 + 手填框 + 候选下拉 + 一句态说明。 */',
 '            h += \'<div class="wfl-params">\';',
 '            for (const r of st.paramRows) {',
 '                h += \'<div class="wfl-prow">\';',
 '                h += \'<span class="wfl-pkey" title="\' + esc(r.hint || \'\') + \'">\' + esc(r.label) + \'</span>\';',
 '                h += \'<input class="wfl-input" data-wf-param="\' + String(st.index) + \':\' + esc(r.key) + \'" value="\' + esc(r.value) + \'" placeholder="可留空" />\';',
 '                if ((r.options || []).length) {',
 '                    h += \'<select class="wfl-input wfl-input-sel" data-wf-pick="\' + String(st.index) + \':\' + esc(r.key) + \'">\';',
 '                    h += \'<option value="">从候选里挑(可不选)</option>\';',
 '                    for (const o of r.options) {',
 '                        h += \'<option value="\' + esc(o.value) + \'"\' + ((r.value && r.value === o.value) ? \' selected\' : \'\') + \'>\' + esc(o.label) + \'</option>\';',
 '                    }',
 '                    h += \'</select>\';',
 '                }',
 '                h += \'<span class="wfl-pstate\' + ((r.state === OP_PARAM_STATES.unknownKey || r.state === OP_PARAM_STATES.candidatesMissing) ? \' wfl-pstate-bad\' : \'\') + \'">\' + esc(r.line) + \'</span>\';',
 '                h += \'</div>\';',
 '            }',
 '            h += \'</div>\';',
 '        }',
]
lines[start:end + 1] = new_block
src = '\n'.join(lines)

# 7 face option labels
A7 = "            for (const f of st.faces) h += '<option value=\"' + esc(f) + '\"' + ((st.when && st.when.face === f) ? ' selected' : '') + '>' + esc(f) + '</option>';"
once(A7, 'face-select')
NEW7 = "            for (const f of (st.faceOptions || [])) h += '<option value=\"' + esc(f.value) + '\"' + ((st.when && st.when.face === f.value) ? ' selected' : '') + '>' + esc(f.label) + '</option>';"
src = src.replace(A7, NEW7, 1)

# 8 preview block before steps render
A8 = '    const steps = v.draftSteps || [];'
once(A8, 'steps-local')
NEW8 = ('    /* [v4.20.0 . R4-O8] 会替谁做什么:先给人话,再给可点的步骤。 */\n'
  '    h += \'<div class="wfl-preview"><div class="wfl-step-label">会替本项目做什么</div>\';\n'
  '    h += \'<div class="wfl-reads">\' + esc(v.previewText || \'\') + \'</div>\';\n'
  '    for (const p of (v.previewRows || [])) {\n'
  '        h += \'<div class="wfl-ptext\' + (p.writes ? \' wfl-ptext-write\' : \'\') + \'">\' + esc(p.sentence) + \'</div>\';\n'
  '    }\n'
  '    h += \'</div>\';\n'
  + A8)
src = src.replace(A8, NEW8, 1)

# 9 bind pick
A9 = "    on('[data-wf-repeat]', 'change',"
once(A9, 'bind-repeat')
NEW9 = ("    on('[data-wf-pick]', 'change', function (n) {\n"
  "        const p = String(n.getAttribute('data-wf-pick')).split(':');\n"
  "        design.pick(Number(p[0]), p.slice(1).join(':'), String(n.value || ''));\n"
  "    });\n" + A9)
src = src.replace(A9, NEW9, 1)

# 10 design.pick method
A10 = '    repeat(index, count) {'
once(A10, 'repeat-method')
NEW10 = ("    /** [v4.20.0 . R4-O8] 从候选里点一个对象填进参数(与手填走同一个绑定口,不另开写路径)。 */\n"
  "    pick(index, key, value) {\n"
  "        const d = this._draft;\n"
  "        const i = Number(index);\n"
  "        const okIdx = (i >= 0 && i < d.steps.length);\n"
  "        const obj = Object.assign({}, (okIdx && d.steps[i] && d.steps[i].params) || {});\n"
  "        const v = String(value == null ? '' : value);\n"
  "        if (v) obj[key] = v; else delete obj[key];\n"
  "        return this.params(i, obj);\n"
  "    }\n" + A10)
src = src.replace(A10, NEW10, 1)

io.open(P, 'w', encoding='utf-8').write(src)
print('PATCH-OK', len(src))
