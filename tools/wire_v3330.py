#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wire_v3330.py — 把两个剧情型对局（剧本杀 / 心动飞行棋）接进游戏大厅

做什么（全部定点，每处断言恰中 1 次）：
  ① apps/games/games-app.js
     · import 四个新件 + 两个纯函数
     · 三条节流 / 概率常量
     · 三个实例槽位 + 三个驱动位
     · openScriptKill / openLudo 两个入口
     · 编排层整块（从 /tmp/v3330_orch.js 读，插在 handleSwipeBack 之前）
     · backToLobby / deactivate 的级联清退（两处同形，各加两行）
     · handleSwipeBack 的两条守卫 + 视图名单扩两员
  ② apps/games/poker/poker-view.js
     · 大厅两张卡片（剧本杀 / 心动飞行棋）
     · 两条点击绑定
  ③ apps/games/poker/poker.css
     · 两套卡片配色 + 图标底板落点

纪律：默认 dry-run，`--write` 才落盘；先逐处断言再写。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
APP = 'apps/games/games-app.js'
PV = 'apps/games/poker/poker-view.js'
PC = 'apps/games/poker/poker.css'
ORCH = '/tmp/v3330_orch.js'


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, text):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(text)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new)


def replace_all(s, old, new, tag, expect):
    n = s.count(old)
    assert n == expect, '[%s] 锚点必须恰中 %d 次，实得 %d' % (tag, expect, n)
    return s.replace(old, new)


# ────────────────────────── ① games-app.js ──────────────────────────
app = rd(APP)
before = len(app)

app = once(
    app,
    "import { GuessWhatView } from './guesswhat/guesswhat-view.js';\n",
    "import { GuessWhatView } from './guesswhat/guesswhat-view.js';\n"
    "import { ScriptKillData } from './scriptkill/scriptkill-data.js';\n"
    "import { ScriptKillView } from './scriptkill/scriptkill-view.js';\n"
    "import { LudoData, rollLudoDice, isLudoEventCell } from './ludo/ludo-data.js';\n"
    "import { LudoView } from './ludo/ludo-view.js';\n",
    'imports'
)

app = once(
    app,
    "const DIALOG_GAME_API_COOLDOWN_MS = 5000;\n",
    "const DIALOG_GAME_API_COOLDOWN_MS = 5000;\n"
    "// [v3.33.0] 两个「剧情型对局」的节流与概率（与上一批同量级）。\n"
    "//   剧本杀的搜证空手率是大厅原口径（30%），不是本仓新定的口味。\n"
    "const SCRIPTKILL_AI_STEP_DELAY_MS = 1800;\n"
    "const SCRIPTKILL_SEARCH_EMPTY_RATE = 0.3;\n"
    "const LUDO_AI_STEP_DELAY_MS = 800;\n",
    'constants'
)

app = once(
    app,
    "        this.guessWhatView = new GuessWhatView(this);\n",
    "        this.guessWhatView = new GuessWhatView(this);\n"
    "        this.scriptKillData = new ScriptKillData(storage);\n"
    "        this.scriptKillView = new ScriptKillView(this);\n"
    "        this.ludoData = new LudoData(storage);\n"
    "        this.ludoView = new LudoView(this);\n",
    'slots'
)

app = once(
    app,
    "        this._guessWhatSending = false;\n"
    "        this._dialogGameLastApiAt = 0;\n",
    "        this._guessWhatSending = false;\n"
    "        this._scriptKillDriving = false;\n"
    "        this._scriptKillVoting = false;\n"
    "        this._ludoDriving = false;\n"
    "        this._dialogGameLastApiAt = 0;\n",
    'flags'
)

app = once(
    app,
    "    openGuessWhat() {\n"
    "        this.applyPhoneChromeTheme();\n"
    "        this.currentView = 'guesswhat';\n"
    "        this.guessWhatView.render();\n"
    "    }\n",
    "    openGuessWhat() {\n"
    "        this.applyPhoneChromeTheme();\n"
    "        this.currentView = 'guesswhat';\n"
    "        this.guessWhatView.render();\n"
    "    }\n"
    "    openScriptKill() {\n"
    "        this.applyPhoneChromeTheme();\n"
    "        this.currentView = 'scriptkill';\n"
    "        this.scriptKillView.render();\n"
    "    }\n"
    "    openLudo() {\n"
    "        this.applyPhoneChromeTheme();\n"
    "        this.currentView = 'ludo';\n"
    "        this.ludoView.render();\n"
    "    }\n",
    'open-methods'
)

with open(ORCH, encoding='utf-8') as f:
    orch = f.read()
assert 'advanceScriptKill' in orch and 'rollLudo' in orch, '编排层内容不完整'
app = once(
    app,
    "    handleSwipeBack() {\n",
    orch.rstrip('\n') + "\n    handleSwipeBack() {\n",
    'orchestration'
)

app = replace_all(
    app,
    "        this.guessWhatView?.destroy?.();\n",
    "        this.guessWhatView?.destroy?.();\n"
    "        this.scriptKillView?.destroy?.();\n"
    "        this.ludoView?.destroy?.();\n",
    'cascade',
    2
)

app = once(
    app,
    "    backToLobby() {\n        this.stopUndercoverFlow?.();\n",
    "    backToLobby() {\n        this.stopUndercoverFlow?.();\n"
    "        this.stopScriptKillFlow?.();\n"
    "        this.stopLudoFlow?.();\n",
    'backToLobby-stop'
)

app = once(
    app,
    "        if (this.currentView === 'guesswhat' && this.guessWhatView?.handleBack?.()) {\n"
    "            return;\n"
    "        }\n",
    "        if (this.currentView === 'guesswhat' && this.guessWhatView?.handleBack?.()) {\n"
    "            return;\n"
    "        }\n"
    "        if (this.currentView === 'scriptkill' && this.scriptKillView?.handleBack?.()) {\n"
    "            return;\n"
    "        }\n"
    "        if (this.currentView === 'ludo' && this.ludoView?.handleBack?.()) {\n"
    "            return;\n"
    "        }\n",
    'backguards'
)

app = once(
    app,
    "|| this.currentView === 'seaturtle' || this.currentView === 'guesswhat') {",
    "|| this.currentView === 'seaturtle' || this.currentView === 'guesswhat' "
    "|| this.currentView === 'scriptkill' || this.currentView === 'ludo') {",
    'viewlist'
)

# ────────────────────────── ② poker-view.js ──────────────────────────
pv = rd(PV)

CARD_ANCHOR = """                    <button class="games-game-card games-poker-card" id="games-open-poker" type="button">"""
NEW_CARDS = """                    <button class="games-game-card games-scriptkill-card" id="games-open-scriptkill" type="button">
                        <div class="games-game-art">
                            <div class="games-scriptkill-lobby-art" aria-hidden="true">
                                <i class="fa-solid fa-masks-theater"></i>
                            </div>
                        </div>
                        <div class="games-game-info">
                            <div class="games-game-title">剧本杀</div>
                            <div class="games-game-desc">抽角色 · 搜证 · 指认凶手</div>
                        </div>
                        <i class="fa-solid fa-chevron-right games-game-chevron"></i>
                    </button>
                    <button class="games-game-card games-ludo-card" id="games-open-ludo" type="button">
                        <div class="games-game-art">
                            <div class="games-ludo-lobby-art" aria-hidden="true">
                                <i class="fa-solid fa-dice"></i>
                            </div>
                        </div>
                        <div class="games-game-info">
                            <div class="games-game-title">心动飞行棋</div>
                            <div class="games-game-desc">掷骰前进 · 踩到就聊聊</div>
                        </div>
                        <i class="fa-solid fa-chevron-right games-game-chevron"></i>
                    </button>
"""
pv = once(pv, CARD_ANCHOR, NEW_CARDS + CARD_ANCHOR, 'cards')

BIND_ANCHOR = """        document.getElementById('games-open-guesswhat')?.addEventListener('click', () => {
            this.app.openGuessWhat();
        });
"""
NEW_BIND = BIND_ANCHOR + """        document.getElementById('games-open-scriptkill')?.addEventListener('click', () => {
            this.app.openScriptKill();
        });
        document.getElementById('games-open-ludo')?.addEventListener('click', () => {
            this.app.openLudo();
        });
"""
pv = once(pv, BIND_ANCHOR, NEW_BIND, 'card-bind')

# ────────────────────────── ③ poker.css ──────────────────────────
pc = rd(PC)
CSS_ANCHOR = ".games-lobby-card {\n"
NEW_CSS = """.games-scriptkill-card {
    border-color: rgba(122, 92, 255, 0.26);
    background:
        linear-gradient(135deg, rgba(122, 92, 255, 0.2), rgba(255, 255, 255, 0.06)),
        rgba(255, 255, 255, 0.07);
}
.games-scriptkill-lobby-art {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background:
        radial-gradient(circle at 50% 26%, rgba(226, 220, 252, 0.94), transparent 34%),
        linear-gradient(145deg, #4a3b78, #14131b 66%);
    color: #f3effc;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.24);
    font-size: 13px;
}
.games-ludo-card {
    border-color: rgba(214, 122, 158, 0.26);
    background:
        linear-gradient(135deg, rgba(214, 122, 158, 0.2), rgba(255, 255, 255, 0.06)),
        rgba(255, 255, 255, 0.07);
}
.games-ludo-lobby-art {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background:
        radial-gradient(circle at 50% 26%, rgba(252, 224, 233, 0.94), transparent 34%),
        linear-gradient(145deg, #7a3b53, #1b1316 66%);
    color: #fcecf1;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.24);
    font-size: 13px;
}
"""
pc = once(pc, CSS_ANCHOR, NEW_CSS + CSS_ANCHOR, 'card-css')

print('games-app.js: %d → %d 字符' % (before, len(app)))
print('poker-view.js: 卡片 2 张 / 绑定 2 条')
print('poker.css: 卡片样式 2 套')
print('dry-run 全过' + ('（--write 已落盘）' if WRITE else '（未落盘）'))

if WRITE:
    wr(APP, app)
    wr(PV, pv)
    wr(PC, pc)
    print('已写入')
