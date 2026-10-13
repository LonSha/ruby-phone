import io
p = 'apps/traveldesk/traveldesk-view.js'
s = io.open(p, encoding='utf-8').read()
orig = s

# (A) 视图段:插在「结算」段之后、「结算提交」段之前
a_old = "/* [v3.87.0 · 拓展计划 R-X3] 结算提交\uff08四态 + 预览 + 确认/撤销\uff09。"
assert s.count(a_old) == 1, 'anchor A'
party_html = '''        /* [v4.03.0 · R3-X6] 协作行程板。
         *   ★ 三件事必须分开显示,合起来就会骗人:
         *     1 **预计花费与实际金额分列**(估的不落账 —— 合并成一个「总花费」会让人以为
         *        估算已经花掉了,这是本仓最贵的一类财务错读数);
         *     2 **参加人数按 accepted 算**,婉拒与未答复各报一条(「没拒绝 ≠ 参加」);
         *     3 读不出这一板 ⇒ 说「还没取到」,**不**说「这一板是空的」。
         *   ★ 视图不自己算读数、不自己判参加者、不自己写账本 —— 只把动作交给宿主。 */
        h += '<div class="tv-sec"><h3>协作行程(人员 / 顺序 / 分工 / 清单 / 共同费用)</h3>';
        if (!vm.party) {
            h += '<div class="tv-empty">还没取到行程板(等下一次剧情时间推进后刷新)</div>';
        } else {
            const rd = vm.partyReadings || null;
            h += '<div class="tv-row"><span>成员</span><span>' + num(rd && rd.members)
                + '(参加 ' + num(rd && rd.accepted) + ' · 婉拒 ' + num(rd && rd.declined) + ' · 未答复 ' + num(rd && rd.pending) + ')</span></div>';
            h += '<div class="tv-row"><span>预计花费(不落账)</span><span>' + money(rd && rd.estimatedTotal) + ' · ' + num(rd && rd.estimatedCount) + ' 笔</span></div>';
            h += '<div class="tv-row"><span>实际金额</span><span>' + money(rd && rd.actualTotal) + ' · ' + num(rd && rd.actualCount) + ' 笔</span></div>';
            h += '<div class="tv-row"><span>已生成支出 / 待生成</span><span>' + num(rd && rd.committedCount) + ' / ' + num(rd && rd.pendingCommit) + '</span></div>';
            h += '<div class="tv-row"><span>地点 / 分工 / 清单</span><span>' + num(rd && rd.stops) + ' · ' + num(rd && rd.tasksDone) + '/' + num(rd && rd.tasks) + ' · ' + num(rd && rd.checksDone) + '/' + num(rd && rd.checks) + '</span></div>';
            /* 成员 */
            if (vm.party.members.length) {
                for (const m of vm.party.members) {
                    h += '<div class="tv-row tv-party-mem"><span>' + esc(m.name) + ' · ' + esc(m.state) + '</span>'
                        + '<span><button class="tv-btn tv-mini" data-act="tvp-mem" data-name="' + esc(m.name) + '" data-state="accepted">参加</button>'
                        + '<button class="tv-btn tv-mini" data-act="tvp-mem" data-name="' + esc(m.name) + '" data-state="declined">婉拒</button></span></div>';
                }
            } else h += '<div class="tv-empty">还没有成员。</div>';
            /* 地点顺序 */
            if (vm.party.stops.length) h += '<div class="tv-note">路线:' + esc(vm.party.stops.map(function (x, i) { return String(i + 1) + '.' + x.place; }).join(' → ')) + '</div>';
            /* 分工与清单 */
            for (const t of vm.party.tasks) h += '<div class="tv-row"><span>' + (t.done ? '☑ ' : '☐ ') + esc(t.title) + (t.owner ? ' · ' + esc(t.owner) : '') + '</span><span><button class="tv-btn tv-mini" data-act="tvp-task" data-id="' + esc(t.id) + '">' + (t.done ? '取消' : '打勾') + '</button></span></div>';
            for (const c of vm.party.checklist) h += '<div class="tv-row"><span>' + (c.done ? '☑ ' : '☐ ') + esc(c.text) + '</span><span><button class="tv-btn tv-mini" data-act="tvp-check" data-id="' + esc(c.id) + '">' + (c.done ? '取消' : '打勾') + '</button></span></div>';
            /* 共同费用:预计与实际两态显式不同色 */
            for (const c of vm.party.costs) {
                h += '<div class="tv-row tv-party-cost' + (c.state === 'estimated' ? ' is-est' : ' is-act') + '"><span>' + esc(c.title) + ' · ' + esc(c.payer) + '</span><span>'
                    + money(c.finalCNY) + ' <span class="tv-party-tag">' + esc(c.state === 'estimated' ? '估算' : (c.state === 'actual' ? '实际' : '已结算')) + '</span>'
                    + '<button class="tv-btn tv-mini" data-act="tvp-cost-state" data-id="' + esc(c.id) + '" data-state="' + (c.state === 'actual' ? 'estimated' : 'actual') + '">' + (c.state === 'actual' ? '改回估算' : '标实际') + '</button></span></div>';
            }
            const dec = [];
            for (const m of vm.party.members) if (m.state === 'declined') dec.push(m.name);
            if (dec.length) h += '<div class="tv-note">已婉拒 ' + esc(dec.join('/')) + ' —— 不参与本次分摊。</div>';
            h += '<div class="tv-row"><button class="tv-btn" data-act="tvp-people">把参加的人加进账本人头</button>'
                + '<button class="tv-btn" data-act="tvp-commit">生成实际费用的支出</button></div>';
            /* 建议:只读文本,点不掉也改不动任何东西 */
            if (vm.partyAdvice && vm.partyAdvice.length) {
                for (const a of vm.partyAdvice) h += '<div class="tv-note tv-party-advice">建议:' + esc(a) + '</div>';
            }
            if (vm.partyRejected && vm.partyRejected.length) h += '<div class="tv-empty">没收 ' + String(vm.partyRejected.length) + ' 条(填不全或认不出,不是静默丢弃)</div>';
            h += '<textarea class="tv-input" data-in="board" placeholder="行程板 JSON"></textarea>'
                + '<button class="tv-btn" data-act="tvp-intake">贴回建板</button>'
                + '<button class="tv-btn" data-act="tvp-clear">清空行程板(不动账本)</button>';
        }
        h += '</div>';
        /* 行程动作回报(与账本动作共用同一 _flash 面,不另开一格) */

'''
s = s.replace(a_old, party_html + a_old, 1)

# (B) 绑定:在 _bind 里加分支
b_old = "                if (act === 'intake') { self.app.intakeBook(val('book')); self.app.render(); }"
b_new = ('''                /* [v4.03.0 · R3-X6] 行程板动作:一律派给宿主的 partyAct(**视图不自己改板**),
                 *   回报写进 _flash 再重渲染 —— 与本件既有动作同一范式。 */
                if (act === 'tvp-intake') { const r = self.app.partyAct('intake', { board: (function () { try { return JSON.parse(val('board')); } catch (e) { return null; } })() }); self._flash = (r && r.note) ? r.note : '这一步没接上'; self.app.render(); }
                else if (act === 'tvp-clear') { const r = self.app.partyAct('clear-board', {}); self._flash = (r && r.note) ? r.note : '这一步没接上'; self.app.render(); }
                else if (act === 'tvp-people') { const r = self.app.partyAct('people', {}); self._flash = (r && r.note) ? r.note : '这一步没接上'; self.app.render(); }
                else if (act === 'tvp-commit') { const r = self.app.partyAct('commit-costs', {}); self._flash = (r && r.note) ? r.note : '这一步没接上'; self.app.render(); }
                else if (act === 'tvp-mem') { const r = self.app.partyAct('member', { member: { name: b.getAttribute('data-name'), state: b.getAttribute('data-state') } }); self._flash = (r && r.note) ? r.note : '这一步没接上'; self.app.render(); }
                else if (act === 'tvp-task') { const r = self.app.partyAct('toggle-task', { id: b.getAttribute('data-id') }); self._flash = (r && r.note) ? r.note : '这一步没接上'; self.app.render(); }
                else if (act === 'tvp-check') { const r = self.app.partyAct('toggle-check', { id: b.getAttribute('data-id') }); self._flash = (r && r.note) ? r.note : '这一步没接上'; self.app.render(); }
                else if (act === 'tvp-cost-state') { const r = self.app.partyAct('set-cost-state', { id: b.getAttribute('data-id'), state: b.getAttribute('data-state') }); self._flash = (r && r.note) ? r.note : '这一步没接上'; self.app.render(); }
                else if (act === 'intake') { self.app.intakeBook(val('book')); self.app.render(); }''')
assert s.count(b_old) == 1, 'anchor B'
s = s.replace(b_old, b_new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched bytes', len(orig), '->', len(s))