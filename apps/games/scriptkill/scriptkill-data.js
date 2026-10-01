/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  剧本杀 数据层
 * --------------------------------------------------------
 *  源侧（EPhone 游戏大厅）把剧本、投票、搜证、AI 事件全塞在一个
 *  `scriptKillGameState` 里，落 Dexie（`db.scriptKillScripts`）。
 *  本件只取**状态机**：阶段链、角色/线索结构、投票计票、搜证次数。
 *  落本仓 PhoneStorage（键 `chat_games_scriptkill_state`）。
 * ======================================================== */

import { numOrNull } from '../../../config/num-gate.js';

const STORAGE_KEY = 'chat_games_scriptkill_state';

/** 阶段链（源侧 `processScriptKillTurn` 的 switch 顺序，一字不改） */
export const SK_PHASES = [
    'start',
    'introduction',
    'timeline_discussion',
    'evidence_round_1',
    'discussion_round_1',
    'evidence_round_2',
    'discussion_round_2',
    'discussion_round_3',
    'voting',
    'end'
];

/** 每个搜证阶段的可搜证次数（源侧：第一轮 2 次、第二轮 1 次） */
export const SK_SEARCH_ALLOWANCE = {
    evidence_round_1: 2,
    evidence_round_2: 1
};

/** 角色分配方式 */
export const SK_ASSIGN_MODES = [
    { value: 'random', label: '随机分配' },
    { value: 'free', label: '我来挑' }
];

/** 线索归属里的「公共」——谁都能搜到 */
export const SK_PUBLIC_OWNER = '公共';

/** 私人物品线索的归属写法（源侧用「XX的私人物品」） */
export const SK_PRIVATE_SUFFIX = '的私人物品';

/** 日志上限，超出后丢最早的（保留首条系统日志） */
const MAX_LOG = 400;

/**
 * 内建剧本（原创；源侧的 `BUILT_IN_SCRIPTS` 不在 game-hall 分片里，
 * 按缝合纪律：源数据一条不搬，本仓自带两份可玩的）。
 * 角色字段：name / description / storyline / tasks / isKiller
 * 线索字段：owner / description
 */
export const SK_BUILT_IN_SCRIPTS = [
    {
        id: 'built_in_1',
        name: '雾港灯塔',
        storyBackground:
            '一九九三年的冬天，雾港的渡轮因为一场大雾停了三天。第四天清晨，'
            + '守塔人沈砚被发现倒在塔顶的回旋楼梯下，手边滚着一只铜制油壶。'
            + '灯塔的日志停在三天前的夜里，最后一页只写了半句「潮位不对」。'
            + '上岛的四个人都说是来帮忙的，但没有人说得清那晚自己在哪里。',
        truth:
            '真正动手的是沈墨。他早知道哥哥把父亲留下的房产证锁进了灯塔的资料柜，'
            + '那晚他带着油壶上塔，本想逼沈砚交出钥匙，争执中把人推下了楼梯。'
            + '顾青梧听到争执声上楼，看到的是已经在楼梯口倒下的沈砚，'
            + '她慌了，把日志最后一页撕下来藏进外套——这就是她一直不肯开口的原因。'
            + '苏黎什么都不知道，她只是那晚恰好值夜班，听到塔上有动静。',
        roles: [
            {
                name: '沈墨',
                description: '死者的弟弟，在城里做旧货生意，手脚利落，说话却总绕圈子。',
                storyline:
                    '三天前你搭末班渡轮上岛，借口是给哥哥送冬衣。实际上你是来要房产证的'
                    + '——父亲留下的老宅要拆迁，没有那张证你一分钱都拿不到。你和哥哥在塔顶'
                    + '吵了一架，油壶从你手里滑出去，他伸手去扶栏杆，你推了他一把。',
                tasks: '把嫌疑引到顾青梧身上：她撕了日志的一页，这件事你亲眼看到。',
                isKiller: true
            },
            {
                name: '顾青梧',
                description: '灯塔的代理管理员，话很少，指甲缝里总有洗不掉的煤灰。',
                storyline:
                    '你接手灯塔才半年。那晚你听到塔顶有争执声，跑上去时沈砚已经倒在'
                    + '楼梯口。你怕被当成凶手，撕下了日志最后一页——那页上记着潮位异常，'
                    + '本来能证明那晚有人在塔上停留了多久。',
                tasks: '你撕了日志这件事瞒不住，但你没杀人。找出真正的凶手。',
                isKiller: false
            },
            {
                name: '苏黎',
                description: '渡轮售票员，笑起来眼睛弯弯的，记性出奇地好。',
                storyline:
                    '那晚你值夜班，看见沈墨上了塔，也看见顾青梧半小时后跟了上去。'
                    + '你没敢多管，只在售票本上把两笔上岛记录都圈了出来。',
                tasks: '你是唯一看见两名嫌疑人先后上塔的人。把时间线讲清楚。',
                isKiller: false
            }
        ],
        clues: [
            { owner: SK_PUBLIC_OWNER, description: '铜制油壶，壶身上有一道新鲜的磕痕，残留的煤油已经干了。' },
            { owner: SK_PUBLIC_OWNER, description: '灯塔日志最后一页被整齐地撕去，撕口很直，像是早有准备。' },
            { owner: SK_PUBLIC_OWNER, description: '塔顶栏杆内侧有一道浅划痕，高度大约到人的腰。' },
            { owner: '沈墨', description: '一张揉皱的拆迁通知，背面用铅笔写着一串数字，像是房产证的编号。' },
            { owner: '沈墨', description: '旧货店的收据，日期是案发前一天，收款人签名潦草。' },
            { owner: '顾青梧', description: '外套内侧的口袋里藏着一页对折的纸，字迹被水洇开了一半。' },
            { owner: '苏黎', description: '售票本上圈出的两笔上岛记录，时间相隔半小时。' }
        ]
    },
    {
        id: 'built_in_2',
        name: '子夜书店',
        storyBackground:
            '城西的旧书店「拾光」只在夜里开门。老板温言把二楼改成了一个不对外的小房间，'
            + '每周三晚上有人来，待两个小时就走。这天凌晨，温言被人发现靠在二楼的'
            + '书架下，手里还捏着一枚铜书签。店门是从里面锁上的。',
        truth:
            '动手的是祁岸。他当年是温言的学生，被温言以「推荐稿」为由拿走了一部未发表的手稿，'
            + '后来那部稿子署了别人的名字出版。祁岸等了六年，等到那本书再版，'
            + '才找到书店。争执中他推了温言，书架倒下来砸中了人。他拿走了那枚书签，'
            + '因为它背面刻着手稿的编号——那是他唯一能追回的凭证。',
        roles: [
            {
                name: '祁岸',
                description: '三十出头的旧书修复师，手指修长，说话慢，眼睛不看人。',
                storyline:
                    '六年前你把一部长篇交给当时的编辑温言，他夸你写得好，然后稿子没了。'
                    + '那本书去年再版，作者名字是别人。你查了两年才查到这间书店。'
                    + '那晚你们在二楼吵架，你推了他，书架倒了。你从地上捡走了那枚书签。',
                tasks: '书签在你身上，这是你唯一没处理干净的物证。',
                isKiller: true
            },
            {
                name: '温宁',
                description: '死者的侄女，在书店帮忙看店，说话很轻但从不退让。',
                storyline:
                    '你从小在书店长大。你知道舅舅每周三晚上在二楼见人，也知道他这些年'
                    + '做过不少不体面的事。那晚你在一楼整理书，听见楼上有争执，'
                    + '但你没上去——你以为是又一个被气走的年轻人。',
                tasks: '把你知道的「周三的客人」讲出来，里面有凶手。',
                isKiller: false
            },
            {
                name: '傅棹',
                description: '常来淘书的中学老师，戴一副旧眼镜，随身带一只帆布包。',
                storyline:
                    '你是这里的常客，那晚你来取订好的旧版诗集。你到的时候书店灯还亮着，'
                    + '门却已经从里面锁上了。你在门口站了很久，看见有人从后巷出来。',
                tasks: '你看见的那个从后巷出来的人，是本案的关键。',
                isKiller: false
            },
            {
                name: '阿萦',
                description: '在书店隔壁开夜宵摊的姑娘，嗓门大，记性好。',
                storyline:
                    '那晚你收摊晚，看见一个人从书店后巷出来，手上拿着什么在灯下晃了一下，'
                    + '像是金属。你记得他穿的是深色外套，走路时左脚有点跛。',
                tasks: '描述你看到的那个人的特征，帮大家缩小范围。',
                isKiller: false
            }
        ],
        clues: [
            { owner: SK_PUBLIC_OWNER, description: '二楼倒下的书架，压着的地面上有一个圆形的印记，像是有人长时间站着。' },
            { owner: SK_PUBLIC_OWNER, description: '店门的内锁完好，没有撬动痕迹——门是从店里面锁上的。' },
            { owner: SK_PUBLIC_OWNER, description: '柜台上摊着一份再版书的宣传页，作者名被红笔圈了起来。' },
            { owner: '祁岸', description: '一只旧眼镜盒，里面没有眼镜，只有一张写着编号的便签。' },
            { owner: '祁岸', description: '修复工具箱的夹层里有一页泛黄的手稿，笔迹与人不同。' },
            { owner: '温宁', description: '一串备用钥匙，其中一把的齿已经被磨圆了。' },
            { owner: '傅棹', description: '帆布包里一本旧版诗集，扉页有温言六年前的题字。' },
            { owner: '阿萦', description: '夜宵摊的记账本，背面画着一个跛脚的简笔人。' }
        ]
    }
];

/** 按 id 取内建剧本（与源侧 `getBuiltInScript` 同形：找不到返回 null） */
export function getBuiltInSkScript(scriptId) {
    const key = String(scriptId || '');
    if (!key) return null;
    return SK_BUILT_IN_SCRIPTS.find(script => script.id === key) || null;
}

/** 线索的唯一键：用描述本身（源侧 `collectedClueIds` 即以 description 为键） */
export function clueKey(clue = {}) {
    return String(clue?.description || '').trim();
}

/**
 * 该玩家的**私人物品归属名**（源侧口径：`clue.owner` 只存角色名）。
 *
 * ★ 用 `roleName` 而不是 `name`：`name` 是玩家昵称，昵称与角色名不一致时
 *   按昵称匹配等于谁都搜不到自己的东西（真·静默失效）。
 */
export function privateOwnerOf(player = {}) {
    return String(player?.roleName || '').trim();
}
/** 线索归属的**显示串**：公共区域 / 「XX 的私人物品」（源侧的显示拼接） */
export function ownerDisplayOf(owner = '') {
    const o = String(owner || '').trim();
    if (!o) return '不明';
    return o === SK_PUBLIC_OWNER ? '公共区域' : `${o}${SK_PRIVATE_SUFFIX}`;
}

export class ScriptKillData {
    constructor(storage) {
        this.storage = storage;
        this.state = this._load();
    }

    getState() {
        return this.state;
    }

    _empty() {
        return {
            phase: 'setup',
            scriptId: '',
            scriptName: '',
            assignMode: 'random',
            players: [],
            log: [],
            searchCounts: {},
            collectedClueIds: [],
            discussionRound: 1,
            votes: {},
            winner: '',
            resultText: '',
            truthRevealed: false,
            startedAt: 0,
            endedAt: 0,
            updatedAt: 0
        };
    }

    _load() {
        const saved = this.storage?.get?.(STORAGE_KEY);
        if (!saved || typeof saved !== 'object') return this._empty();
        const base = this._empty();
        return {
            ...base,
            ...saved,
            players: Array.isArray(saved.players) ? saved.players.map(player => this._normalizePlayer(player)) : [],
            log: Array.isArray(saved.log) ? saved.log.filter(entry => entry && typeof entry === 'object') : [],
            collectedClueIds: Array.isArray(saved.collectedClueIds)
                ? saved.collectedClueIds.map(id => String(id || '')).filter(Boolean)
                : [],
            votes: (saved.votes && typeof saved.votes === 'object') ? { ...saved.votes } : {},
            searchCounts: (saved.searchCounts && typeof saved.searchCounts === 'object') ? { ...saved.searchCounts } : {},
            discussionRound: numOrNull(saved.discussionRound) ?? 1
        };
    }

    _normalizePlayer(player = {}) {
        return {
            id: String(player.id || ''),
            name: String(player.name || '').trim() || '玩家',
            avatar: String(player.avatar || ''),
            persona: String(player.persona || '').trim(),
            isUser: !!player.isUser,
            roleId: String(player.roleId || ''),
            roleName: String(player.roleName || ''),
            description: String(player.description || ''),
            storyline: String(player.storyline || ''),
            tasks: String(player.tasks || ''),
            isKiller: !!player.isKiller,
            evidence: Array.isArray(player.evidence) ? player.evidence.map(item => String(item || '')).filter(Boolean) : []
        };
    }

    _save() {
        this.state.updatedAt = Date.now();
        this.storage?.set?.(STORAGE_KEY, this.state);
    }

    // ---------------------------------------------------------------- 设置

    reset() {
        this.state = this._empty();
        this._save();
    }

    getScript() {
        return getBuiltInSkScript(this.state.scriptId);
    }

    setAssignMode(mode = 'random') {
        const value = String(mode || '').trim();
        this.state.assignMode = SK_ASSIGN_MODES.some(item => item.value === value) ? value : 'random';
        this._save();
    }

    // ---------------------------------------------------------------- 开局

    /** 组座：打乱座位，让「谁是凶手」不可从邀请顺序推断 */
    seatPlayers(players = []) {
        const seated = players.map(player => this._normalizePlayer(player)).filter(player => player.id);
        for (let i = seated.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = seated[i];
            seated[i] = seated[j];
            seated[j] = tmp;
        }
        this.state.players = seated;
        return seated;
    }

    /** 本剧本需要几位 AI（源侧口径：角色数 - 1，用户占一个） */
    requiredAiCount(script = this.getScript()) {
        const roles = Array.isArray(script?.roles) ? script.roles : [];
        return Math.max(0, roles.length - 1);
    }

    /**
     * 分配角色。free=true 时用户先挑（userRoleIndex），其余角色洗牌后按序给 AI；
     * free=false 时全员洗牌、角色洗牌，一一对应（源侧两种模式）。
     */
    assignRoles(script, { free = false, userRoleIndex = -1 } = {}) {
        const roles = Array.isArray(script?.roles) ? [...script.roles] : [];
        const players = this.state.players || [];
        if (!roles.length || players.length !== roles.length) return false;

        const picked = new Map();
        let remaining = roles;
        const userPlayer = players.find(player => player.isUser);

        if (free && userPlayer) {
            const idx = numOrNull(userRoleIndex);
            if (idx === null || idx < 0 || idx >= roles.length) return false;
            picked.set(userPlayer.id, roles[idx]);
            remaining = roles.filter((_, i) => i !== idx);
            for (let i = remaining.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = remaining[i];
                remaining[i] = remaining[j];
                remaining[j] = tmp;
            }
            let cursor = 0;
            players.forEach(player => {
                if (player.isUser) return;
                picked.set(player.id, remaining[cursor]);
                cursor += 1;
            });
        } else {
            const shuffledPlayers = [...players];
            for (let i = shuffledPlayers.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = shuffledPlayers[i];
                shuffledPlayers[i] = shuffledPlayers[j];
                shuffledPlayers[j] = tmp;
            }
            const shuffledRoles = [...roles];
            for (let i = shuffledRoles.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = shuffledRoles[i];
                shuffledRoles[i] = shuffledRoles[j];
                shuffledRoles[j] = tmp;
            }
            shuffledPlayers.forEach((player, index) => picked.set(player.id, shuffledRoles[index]));
        }

        this.state.players = players.map(player => {
            const role = picked.get(player.id) || {};
            return {
                ...player,
                roleId: String(role.name || ''),
                roleName: String(role.name || ''),
                description: String(role.description || ''),
                storyline: String(role.storyline || ''),
                tasks: String(role.tasks || ''),
                isKiller: !!role.isKiller
            };
        });
        return true;
    }

    startGame({ scriptId = '', free = false, userRoleIndex = -1 } = {}) {
        const script = getBuiltInSkScript(scriptId);
        if (!script) return false;
        const players = this.state.players || [];
        if (!players.length) return false;
        if (players.length !== script.roles.length) return false;

        this.state.scriptId = script.id;
        this.state.scriptName = script.name;
        this.state.assignMode = free ? 'free' : 'random';
        if (!this.assignRoles(script, { free, userRoleIndex })) return false;

        this.state.phase = 'start';
        this.state.log = [];
        this.state.searchCounts = {};
        this.state.collectedClueIds = [];
        this.state.discussionRound = 1;
        this.state.votes = {};
        this.state.winner = '';
        this.state.resultText = '';
        this.state.truthRevealed = false;
        this.state.startedAt = Date.now();
        this.state.endedAt = 0;

        this.addSystem(`游戏开始！剧本：【${script.name}】`);
        this._save();
        return true;
    }

    // ---------------------------------------------------------------- 阶段

    getPhaseIndex(phase = this.state.phase) {
        return SK_PHASES.indexOf(String(phase || ''));
    }

    nextPhaseOf(phase = this.state.phase) {
        const index = this.getPhaseIndex(phase);
        if (index < 0 || index >= SK_PHASES.length - 1) return 'end';
        return SK_PHASES[index + 1];
    }

    setPhase(phase = '') {
        const value = String(phase || '');
        if (!SK_PHASES.includes(value)) return false;
        this.state.phase = value;
        if (value === 'discussion_round_2') this.state.discussionRound = 2;
        if (value === 'discussion_round_3') this.state.discussionRound = 3;
        this._save();
        return true;
    }

    /** 本阶段**新增**的搜证额度（第一轮 2 次、第二轮 1 次；非搜证阶段 0） */
    searchAllowance(phase = this.state.phase) {
        const value = numOrNull(SK_SEARCH_ALLOWANCE[String(phase || '')]);
        return value ?? 0;
    }
    /**
     * 本阶段的搜证**累计上限**。
     * ★ 源侧 `scriptKillGameState.evidenceCounts` 是**同一个计数器跨两轮累计**
     *   （`evidence_round_1` 补到 2、`evidence_round_2` 补到 3）—— 本件必须是累计口径。
     *   若拿「本阶段新增额度」去比同一个累计计数（起手那版就是），第二轮时计数
     *   已等于第一轮用掉的 2，`remaining` 恒为负、被 `Math.max(0,…)` 压成 0 ——
     *   于是**用户按钮永远灰着，第二轮补搜永远搜不了**，且全程不报错。
     *   这是本版起手抓到的真缺陷（由本套件 A 组钉住）。
     */
    searchCapOf(phase = this.state.phase) {
        const round1 = numOrNull(SK_SEARCH_ALLOWANCE.evidence_round_1) ?? 0;
        const round2 = numOrNull(SK_SEARCH_ALLOWANCE.evidence_round_2) ?? 0;
        const value = String(phase || '');
        if (value === 'evidence_round_1') return round1;
        if (value === 'evidence_round_2') return round1 + round2;
        return 0;
    }
    searchCountOf(playerId = '') {
        const key = String(playerId || '');
        if (!key) return 0;
        return numOrNull(this.state.searchCounts[key]) ?? 0;
    }
    /** 本阶段还剩几次搜证机会（用户按钮的可用性判据） */
    remainingSearch(playerId = '', phase = this.state.phase) {
        return Math.max(0, this.searchCapOf(phase) - this.searchCountOf(playerId));
    }

    canSearch(playerId = '', phase = this.state.phase) {
        return this.remainingSearch(playerId, phase) > 0;
    }

    recordSearch(playerId = '') {
        const key = String(playerId || '');
        if (!key) return false;
        if (!this.canSearch(key)) return false;
        this.state.searchCounts[key] = this.searchCountOf(key) + 1;
        this._save();
        return true;
    }

    // ---------------------------------------------------------------- 线索

    isClueCollected(clue = {}) {
        return this.state.collectedClueIds.includes(clueKey(clue));
    }

    /** 这位玩家**能搜到**的线索：公共线索 + 自己的私人物品（源侧口径） */
    availableCluesFor(playerId = '') {
        const script = this.getScript();
        const clues = Array.isArray(script?.clues) ? script.clues : [];
        const player = this.getPlayerById(playerId);
        if (!player) return [];
        const mine = privateOwnerOf(player);
        return clues.filter(clue => {
            const owner = String(clue?.owner || '').trim();
            return owner === SK_PUBLIC_OWNER || owner === mine;
        });
    }

    /** 还没被任何人搜到的线索 */
    uncollectedClues() {
        const script = this.getScript();
        const clues = Array.isArray(script?.clues) ? script.clues : [];
        return clues.filter(clue => !this.isClueCollected(clue));
    }

    collectClue(clue = {}, holderId = '') {
        const key = clueKey(clue);
        if (!key || this.isClueCollected(clue)) return false;
        this.state.collectedClueIds.push(key);
        const holder = this.getPlayerById(holderId);
        if (holder) {
            holder.evidence = Array.isArray(holder.evidence) ? holder.evidence : [];
            if (!holder.evidence.includes(key)) holder.evidence.push(key);
        }
        this._save();
        return true;
    }

    /** 关于**自己**的线索：搜到的人能决定要不要藏（源侧 `reveal_clue` 的判据） */
    isAboutSelf(clue = {}, playerId = '') {
        const player = this.getPlayerById(playerId);
        if (!player) return false;
        return String(clue?.owner || '').trim() === privateOwnerOf(player);
    }

    // ---------------------------------------------------------------- 日志

    _pushLog(entry = {}) {
        const log = this.state.log;
        log.push({
            type: String(entry.type || 'system'),
            text: String(entry.text || ''),
            speakerId: String(entry.speakerId || ''),
            speakerName: String(entry.speakerName || ''),
            speakerAvatar: String(entry.speakerAvatar || ''),
            at: Date.now()
        });
        if (log.length > MAX_LOG) {
            const overflow = log.length - MAX_LOG;
            log.splice(1, overflow);
        }
    }

    addSystem(text = '') {
        this._pushLog({ type: 'system', text });
        this._save();
    }

    addSpeech(player = null, speech = '') {
        this._pushLog({
            type: 'speech',
            text: String(speech || ''),
            speakerId: player?.id || '',
            speakerName: player?.name || '',
            speakerAvatar: player?.avatar || ''
        });
        this._save();
    }

    addSearchResult(player = null, text = '') {
        this._pushLog({
            type: 'search',
            text: String(text || ''),
            speakerId: player?.id || '',
            speakerName: player?.name || '',
            speakerAvatar: player?.avatar || ''
        });
        this._save();
    }

    addVoteLine(text = '') {
        this._pushLog({ type: 'vote', text: String(text || '') });
        this._save();
    }

    // ---------------------------------------------------------------- 投票

    setVote(voterId = '', targetId = '') {
        const key = String(voterId || '');
        if (!key) return false;
        this.state.votes[key] = String(targetId || '');
        this._save();
        return true;
    }

    /** 计票：返回 { counts, topIds, tie } —— 票数为 0 者不入表 */
    tallyVotes() {
        const counts = {};
        const votes = this.state.votes || {};
        Object.keys(votes).forEach(voterId => {
            const targetId = String(votes[voterId] || '');
            if (!targetId) return;
            counts[targetId] = (numOrNull(counts[targetId]) ?? 0) + 1;
        });
        let maxVotes = 0;
        let topIds = [];
        Object.keys(counts).forEach(playerId => {
            const value = counts[playerId];
            if (value > maxVotes) {
                maxVotes = value;
                topIds = [playerId];
            } else if (value === maxVotes) {
                topIds.push(playerId);
            }
        });
        return { counts, topIds, tie: topIds.length > 1 };
    }

    /** 结算：只有「唯一最高票 == 凶手」才算好人阵营胜（源侧口径） */
    resolveVotes() {
        const killer = this.getKiller();
        const { topIds } = this.tallyVotes();
        const hit = !!killer && topIds.length === 1 && topIds[0] === killer.id;
        const winner = hit ? '好人阵营' : '凶手阵营';
        const roleName = killer?.roleName || '—';
        const playerName = killer?.name || '—';
        const resultText = hit
            ? `恭喜！你们成功指认出凶手【${roleName}（${playerName}）】！好人阵营胜利！`
            : `很遗憾，真正的凶手是【${roleName}（${playerName}）】！凶手阵营胜利！`;
        this.state.winner = winner;
        this.state.resultText = resultText;
        this._save();
        return { winner, resultText, hit };
    }

    revealTruth() {
        this.state.truthRevealed = true;
        this.state.phase = 'end';
        this.state.endedAt = Date.now();
        this._save();
    }

    // ---------------------------------------------------------------- 查询

    getKiller() {
        return (this.state.players || []).find(player => player.isKiller) || null;
    }

    getUserPlayer() {
        return (this.state.players || []).find(player => player.isUser) || null;
    }

    getPlayerById(playerId = '') {
        const key = String(playerId || '');
        return (this.state.players || []).find(player => player.id === key) || null;
    }

    getAiPlayers() {
        return (this.state.players || []).filter(player => !player.isUser);
    }

    /** 用户是否该在这一步行动（自我介绍 / 时间线 / 讨论 / 投票） */
    isUserTurnPhase(phase = this.state.phase) {
        return ['introduction', 'timeline_discussion', 'discussion_round_1',
            'discussion_round_2', 'discussion_round_3', 'voting'].includes(String(phase || ''));
    }

    getSummary() {
        const user = this.getUserPlayer();
        const killer = this.getKiller();
        return [
            '**剧本杀 · 复盘**',
            '',
            `**剧本:** ${this.state.scriptName || '—'}`,
            `**你的角色:** ${user?.roleName || '—'}`,
            `**阵营结果:** ${this.state.winner || '—'}`,
            '',
            '**真相:**',
            this.getScript()?.truth || '—',
            '',
            '**凶手:**',
            killer ? `${killer.roleName}（${killer.name}）` : '—'
        ].join('\n');
    }
}
