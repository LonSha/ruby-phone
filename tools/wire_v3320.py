# -*- coding: utf-8 -*-
"""v3.32.0 接线：把海龟汤 / 你说我猜 两个 AI 对局小游戏挂进 games 容器。
   逐锚点断言命中恰 1 次，失败即退出（不改半截）。"""
import io
import sys

R = '/home/user/ruby-phone/'
APP = R + 'apps/games/games-app.js'

s = io.open(APP, encoding='utf-8').read()
orig = s


def once(old, new, tag):
    global s
    n = s.count(old)
    assert n == 1, '锚点 [%s] 命中 %d 次（应为 1）' % (tag, n)
    s = s.replace(old, new)


# 1) import
once(
    "import { BoardData } from './board/board-data.js';\nimport { BoardView } from './board/board-view.js';\n",
    "import { BoardData } from './board/board-data.js';\nimport { BoardView } from './board/board-view.js';\n"
    "import { SeaTurtleData } from './seaturtle/seaturtle-data.js';\n"
    "import { SeaTurtleView } from './seaturtle/seaturtle-view.js';\n"
    "import { GuessWhatData } from './guesswhat/guesswhat-data.js';\n"
    "import { GuessWhatView } from './guesswhat/guesswhat-view.js';\n",
    'import'
)

# 2) 常量（两个对局的回合节流，与既有 WEREWOLF_/UNDERCOVER_ 同风格）
once(
    "const UNDERCOVER_API_COOLDOWN_MS = 5000;\n",
    "const UNDERCOVER_API_COOLDOWN_MS = 5000;\n"
    "// [v3.32.0] 两个「AI 对局」小游戏的节流：AI 思考间隔 / 连续请求冷却。\n"
    "//   取值与狼人杀、谁是卧底保持同一量级，避免同桌并发打满代理。\n"
    "const SEATURTLE_AI_STEP_DELAY_MS = 2200;\n"
    "const GUESSWHAT_AI_STEP_DELAY_MS = 1200;\n"
    "const DIALOG_GAME_API_COOLDOWN_MS = 5000;\n",
    'const'
)

# 3) 构造期实例化
once(
    "        this.boardData = new BoardData(storage);\n        this.boardView = new BoardView(this);\n",
    "        this.boardData = new BoardData(storage);\n        this.boardView = new BoardView(this);\n"
    "        this.seaTurtleData = new SeaTurtleData(storage);\n"
    "        this.seaTurtleView = new SeaTurtleView(this);\n"
    "        this.guessWhatData = new GuessWhatData(storage);\n"
    "        this.guessWhatView = new GuessWhatView(this);\n",
    'ctor'
)

# 4) 驱动器状态字段（与 _undercoverDriving 同层）
once(
    "        this._undercoverDriving = false;\n        this._undercoverRunId = 0;\n",
    "        this._undercoverDriving = false;\n"
    "        this._undercoverRunId = 0;\n"
    "        this._seaTurtleDriving = false;\n"
    "        this._guessWhatSending = false;\n"
    "        this._dialogGameLastApiAt = 0;\n",
    'flags'
)

# 5) 打开入口（与 open2048 / openUndercover 同层）
once(
    "    openUndercover() {\n",
    "    openSeaTurtle() {\n"
    "        this.applyPhoneChromeTheme();\n"
    "        this.currentView = 'seaturtle';\n"
    "        this.seaTurtleView.render();\n"
    "    }\n"
    "\n"
    "    openGuessWhat() {\n"
    "        this.applyPhoneChromeTheme();\n"
    "        this.currentView = 'guesswhat';\n"
    "        this.guessWhatView.render();\n"
    "    }\n"
    "\n"
    "    // [v3.32.0] 两个对话型对局共用的一次性 API 冷却：避免连续请求打满代理。\n"
    "    async _waitDialogGameApiCooldown(cooldownMs = DIALOG_GAME_API_COOLDOWN_MS) {\n"
    "        const now = Date.now();\n"
    "        const waited = now - (this._dialogGameLastApiAt || 0);\n"
    "        const bound = numOrNull(cooldownMs) ?? DIALOG_GAME_API_COOLDOWN_MS;\n"
    "        if (waited < bound) {\n"
    "            await new Promise(resolve => setTimeout(resolve, bound - waited));\n"
    "        }\n"
    "        this._dialogGameLastApiAt = Date.now();\n"
    "    }\n"
    "\n"
    "    openUndercover() {\n",
    'openers'
)

# 6) 销毁级联
once(
    "        this.catboxView?.destroy?.();\n        this.werewolfView?.destroy?.();\n        this.undercoverView?.destroy?.();\n        super.backToLobby();\n",
    "        this.catboxView?.destroy?.();\n        this.werewolfView?.destroy?.();\n"
    "        this.undercoverView?.destroy?.();\n"
    "        this.seaTurtleView?.destroy?.();\n"
    "        this.guessWhatView?.destroy?.();\n"
    "        super.backToLobby();\n",
    'backToLobby'
)
once(
    "        this.catboxView?.destroy?.();\n        this.werewolfView?.destroy?.();\n        this.undercoverView?.destroy?.();\n    }\n",
    "        this.catboxView?.destroy?.();\n        this.werewolfView?.destroy?.();\n"
    "        this.undercoverView?.destroy?.();\n"
    "        this.seaTurtleView?.destroy?.();\n"
    "        this.guessWhatView?.destroy?.();\n"
    "    }\n",
    'deactivate'
)

# 7) 返回手势：新视图先接管，再落大厅
once(
    "        if (this.currentView === 'undercover' && this.undercoverView?.handleBack?.()) {\n            return;\n        }\n",
    "        if (this.currentView === 'undercover' && this.undercoverView?.handleBack?.()) {\n            return;\n        }\n"
    "        if (this.currentView === 'seaturtle' && this.seaTurtleView?.handleBack?.()) {\n            return;\n        }\n"
    "        if (this.currentView === 'guesswhat' && this.guessWhatView?.handleBack?.()) {\n            return;\n        }\n",
    'swipe'
)
once(
    "        if (this.currentView === 'game2048' || this.currentView === 'sudoku' || this.currentView === 'catbox' || this.currentView === 'werewolf' || this.currentView === 'undercover') {\n",
    "        if (this.currentView === 'game2048' || this.currentView === 'sudoku' || this.currentView === 'catbox' || this.currentView === 'werewolf' || this.currentView === 'undercover' || this.currentView === 'seaturtle' || this.currentView === 'guesswhat') {\n",
    'swipe2'
)

if '--write' in sys.argv:
    assert s != orig, '没有任何改动'
    io.open(APP, 'w', encoding='utf-8').write(s)
    print('games-app.js written:', len(s), 'bytes')
else:
    print('dry-run: 锚点全部命中恰 1 次，未落盘')
