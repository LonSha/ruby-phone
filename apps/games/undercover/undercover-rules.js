/* ============================================================
 * undercover-rules.js — [v4.190.0] 谁是卧底 · 规则判定的纯函数内核
 * ------------------------------------------------------------
 * 从 apps/games/undercover/undercover-data.js 那 724 行类里抽出来的规则部分：
 *   源的 _normalizeWordPair / _normalizeWordHistory / _splitSpeechSegments /
 *   _normalizeContactIds / _shuffle / _advanceTurn / applyVoteResult 一族
 *   —— 全是「给定状态 -> 给定结论」，不碰 DOM、不碰存储、不碰时间。
 * ------------------------------------------------------------
 * 为什么单独一件：类里其余方法都在动 this.state 并 _save()，那是有副作用的
 *   编排。混在一个文件里，判据只能「跑一遍看不崩」，钉不住任何一条规则不变式
 *   （词对闭不闭合、票怎么算、平票怎么办、谁说下一句、谁赢）。
 * ------------------------------------------------------------
 * 刻意不做：不持状态、不改入参、不自己造随机源（洗牌由调用方传 rng，
 *   否则同一局每次跑出不同结果，判据没法写）、不自己取墙钟。
 * ============================================================ */

/** 一局的人数（6 人桌）。 */
export const PLAYER_COUNT = 6;

/** 最多能邀几个好友进场（自己是 1 号位，其余留给 AI）。 */
export const MAX_INVITED_CONTACTS = PLAYER_COUNT - 1;

/** AI 头像预设个数。 */
export const AI_AVATAR_PRESET_COUNT = 6;

/** 最近词对只记这么多条（超出丢最旧的）。 */
export const MAX_RECENT_WORD_PAIRS = 10;

/** 兜底词对（AI 没给词、或给的词不合规时用）。 */
export const FALLBACK_WORD_PAIRS = Object.freeze([
    Object.freeze(['种草莓', '法式湿吻']),
    Object.freeze(['制服诱惑', '角色扮演']),
    Object.freeze(['传教士', '老汉推车']),
    Object.freeze(['情趣手铐', '丝绸眼罩']),
    Object.freeze(['打桩机', '缝纫机'])
]);

/** 兜底 AI 人设（生成器没给够时按序补）。 */
export const FALLBACK_AI_PROFILES = Object.freeze([
    Object.freeze(['午夜心碎小狗', '擅长装无辜，发言轻松但会悄悄试探别人。']),
    Object.freeze(['纯情男大', '说话直接又有点害羞，遇到怀疑时会认真自证。']),
    Object.freeze(['海王本王', '喜欢带节奏和接话，擅长用暧昧玩笑模糊重点。']),
    Object.freeze(['夜猫观察员', '逻辑细致，习惯抓描述里的矛盾和用词差异。']),
    Object.freeze(['微醺小玫瑰', '语气松弛俏皮，喜欢顺着前面的人发言再反问。'])
]);

/** 身份封闭词表。 */
export const ROLES = Object.freeze(['civilian', 'undercover']);

/** 阶段封闭词表。 */
export const PHASES = Object.freeze(['matching', 'playing', 'voting', 'ended']);

/** 拒绝原因。 */
export const UC_REJECT = Object.freeze({
    notArray: 'not_array',
    emptyWord: 'empty_word',
    sameWord: 'same_word',
    repeatWord: 'repeat_word',
    noFallback: 'no_fallback',
    notPlaying: 'not_playing',
    notVoting: 'not_voting',
    wrongSeat: 'wrong_seat',
    emptyText: 'empty_text',
    noPlayer: 'no_player',
    badState: 'bad_state',
    badVote: 'bad_vote',
    allUsed: 'all_used'
});

/** 发言分段的两条长度阈值（源里写死 52 / 42 / 8 / 7）。 */
export const SPEECH_LIMITS = Object.freeze({
    longPart: 52,
    clauseBuffer: 42,
    maxSegments: 8,
    keepHead: 7
});

/* ---------- 1. 词对归一 ---------- */

/** 词对历史归一：只留「两个词都非空且不相同」的条目，最多留 MAX_RECENT_WORD_PAIRS 条。 */
export function normalizeWordHistory(history) {
    return (Array.isArray(history) ? history : [])
        .map((item) => {
            const civilian = String((item && (item.civilian || item.normal)) || '').trim();
            const undercover = String((item && item.undercover) || '').trim();
            if (!civilian || !undercover || civilian === undercover) return null;
            return { civilian, undercover };
        })
        .filter(Boolean)
        .slice(-MAX_RECENT_WORD_PAIRS);
}

/** 把词对历史摊成一组小写词（用于判重）。 */
export function usedWordSet(history) {
    const set = new Set();
    for (const item of normalizeWordHistory(history)) {
        set.add(item.civilian.toLocaleLowerCase());
        set.add(item.undercover.toLocaleLowerCase());
    }
    return set;
}

/**
 * 词对归一：合规就用原词；不合规（空 / 两词相同 / 与最近用过重复）就落到兜底池。
 *   rng 由调用方给（兜底池里挑哪个），不给时取第一个未用过的。
 * 返回值：{ ok, reason, civilian, undercover, fromFallback }
 *   - ok=false 只有一种情况：兜底池也用光了。
 */
export function normalizeWordPair(wordPair, history, rng) {
    const civilian = String((wordPair && (wordPair.civilian || wordPair.normal)) || '').trim();
    const undercover = String((wordPair && wordPair.undercover) || '').trim();
    const used = usedWordSet(history);
    const repeatsRecent = used.has(civilian.toLocaleLowerCase()) || used.has(undercover.toLocaleLowerCase());
    if (civilian && undercover && civilian !== undercover && !repeatsRecent) {
        return { ok: true, reason: null, civilian, undercover, fromFallback: false };
    }
    const unused = FALLBACK_WORD_PAIRS.filter((pair) => (
        !used.has(String(pair[0] || '').toLocaleLowerCase())
        && !used.has(String(pair[1] || '').toLocaleLowerCase())
    ));
    const pool = unused.length ? unused : FALLBACK_WORD_PAIRS;
    const next = rng || (() => 0);
    const pick = pool[Math.floor(next() * pool.length)] || pool[0];
    if (!pick) return { ok: false, reason: UC_REJECT.noFallback, civilian: '', undercover: '', fromFallback: true };
    return { ok: true, reason: null, civilian: pick[0], undercover: pick[1], fromFallback: true };
}

/** 记住一对词（返回新历史，不改入参）。超过上限丢最旧的。 */
export function rememberWordPair(history, wordPair) {
    const civilian = String((wordPair && wordPair.civilian) || '').trim();
    const undercover = String((wordPair && wordPair.undercover) || '').trim();
    if (!civilian || !undercover || civilian === undercover) return normalizeWordHistory(history);
    return [...normalizeWordHistory(history), { civilian, undercover }].slice(-MAX_RECENT_WORD_PAIRS);
}

/* ---------- 2. 邀请的联系人归一 ---------- */

/** 邀请 id 归一：去空白、去重、按给出顺序、最多 MAX_INVITED_CONTACTS 个。 */
export function normalizeContactIds(ids) {
    return [...new Set((Array.isArray(ids) ? ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean))]
        .slice(0, MAX_INVITED_CONTACTS);
}

/** 从候选联系人里挑出被邀请的几个（按 id 命中，认不出的 id 直接丢）。 */
export function pickInvitedContacts(contacts, selectedIds) {
    const wanted = normalizeContactIds(selectedIds);
    const list = Array.isArray(contacts) ? contacts : [];
    const valid = [];
    const seen = new Set();
    for (const contact of list) {
        const id = String((contact && (contact.id || contact.contactId || contact.name)) || '').trim();
        if (!id || !wanted.includes(id) || seen.has(id)) continue;
        const name = String((contact && (contact.name || contact.remark)) || '').trim();
        if (!name) continue;
        seen.add(id);
        valid.push({
            id,
            name,
            avatar: String((contact && contact.avatar) || '').trim(),
            personality: String((contact && (contact.personality || contact.signature)) || '').trim(),
            source: 'friend',
            isUser: false,
            empty: false
        });
        if (valid.length >= wanted.length) break;
    }
    return valid;
}

/* ---------- 3. 洗牌（rng 由调用方给） ---------- */

/** Fisher–Yates。**不改入参**，返回新数组。同一个 rng 序列 => 同一个结果。 */
export function shuffle(items, rng) {
    const out = Array.isArray(items) ? items.slice() : [];
    const next = rng || (() => 0);
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
}

/* ---------- 4. 座位分配 ---------- */

/**
 * 把人排到 6 个座位：受邀好友按洗出的座位坐，空位留给 AI。
 *   humans 已按「用户在最前」排好；seats 是 1..PLAYER_COUNT 的一个排列（rng 定的）。
 * 返回：{ players, humanBySeat }（players 里空位是 empty:true 的 pending 位）。
 */
export function seatPlayers(humans, seats) {
    const list = Array.isArray(humans) ? humans.slice(0, PLAYER_COUNT) : [];
    const order = Array.isArray(seats) && seats.length === PLAYER_COUNT
        ? seats.slice()
        : Array.from({ length: PLAYER_COUNT }, (_, i) => i + 1);
    const bySeat = new Map(list.map((p, i) => [order[i], p]));
    const players = [];
    for (let seat = 1; seat <= PLAYER_COUNT; seat += 1) {
        const p = bySeat.get(seat);
        if (p) { players.push(Object.assign({}, p, { seat })); continue; }
        players.push({
            id: 'undercover_pending_' + seat,
            name: '匹配中',
            avatar: '',
            personality: '',
            source: 'pending',
            isUser: false,
            empty: true,
            alive: true,
            seat
        });
    }
    return { players, humanBySeat: bySeat };
}

/** 挑一个卧底座位（1..PLAYER_COUNT）。rng 由调用方给。 */
export function pickUndercoverSeat(rng) {
    const next = rng || (() => 0);
    return Math.floor(next() * PLAYER_COUNT) + 1;
}

/* ---------- 5. AI 人设 ---------- */

/** 按需补 AI 人设：生成器给了就用（去重名），不够的用兜底人设按序补。 */
export function buildAiProfiles(count, generated, reservedNames) {
    const n = Math.max(0, Math.floor(count) || 0);
    const used = new Set((Array.isArray(reservedNames) ? reservedNames : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean));
    const valid = [];
    for (const raw of (Array.isArray(generated) ? generated : [])) {
        if (valid.length >= n) break;
        const name = String((raw && (raw.name || raw.title)) || '').trim();
        if (!name || used.has(name)) continue;
        used.add(name);
        valid.push({
            name,
            personality: String((raw && (raw.personality || raw.desc || raw.description)) || '').trim()
        });
    }
    for (let i = 0; valid.length < n; i += 1) {
        if (i >= FALLBACK_AI_PROFILES.length) break;
        const fb = FALLBACK_AI_PROFILES[i];
        if (used.has(fb[0])) continue;
        used.add(fb[0]);
        valid.push({ name: fb[0], personality: fb[1] });
    }
    return valid.slice(0, n);
}

/* ---------- 6. 发言分段 ---------- */

/** 把一大段话切成适合逐条显示的片段（源里的 52/42/8/7 阈值原样保留）。 */
export function splitSpeechSegments(text) {
    const source = String(text || '').replace(/\r/g, '').trim();
    if (!source) return [];
    const sentenceParts = source
        .split(/\n+/)
        .flatMap((line) => line.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [])
        .map((part) => part.trim())
        .filter(Boolean);
    const segments = [];
    sentenceParts.forEach((part) => {
        if (part.length <= SPEECH_LIMITS.longPart) { segments.push(part); return; }
        const clauses = part.match(/[^，,]+[，,]?/g) || [part];
        let buffer = '';
        clauses.forEach((clause) => {
            const next = String(clause || '').trim();
            if (!next) return;
            if (buffer && buffer.length + next.length > SPEECH_LIMITS.clauseBuffer) {
                segments.push(buffer);
                buffer = next;
            } else {
                buffer += next;
            }
        });
        if (buffer) segments.push(buffer);
    });
    if (segments.length <= SPEECH_LIMITS.maxSegments) return segments;
    return [...segments.slice(0, SPEECH_LIMITS.keepHead), segments.slice(SPEECH_LIMITS.keepHead).join('')];
}

/* ---------- 7. 发言轮次 ---------- */

/**
 * 该谁说下一句。返回 { ok, reason, phase, currentSpeakerSeat, status, statusText, advancedRound }
 *   - 全员都说过 -> 转 voting；
 *   - 否则从当前发言者的下一位起，环形找第一个还没说过的。
 */
export function nextSpeaker(game) {
    if (!game || typeof game !== 'object') {
        return { ok: false, reason: UC_REJECT.badState, phase: 'playing', currentSpeakerSeat: 0, status: '', statusText: '', advancedRound: false };
    }
    const players = (Array.isArray(game.players) ? game.players : [])
        .filter((p) => p && p.alive !== false)
        .sort((a, b) => Number(a.seat) - Number(b.seat));
    if (!players.length) {
        return { ok: false, reason: UC_REJECT.noPlayer, phase: 'playing', currentSpeakerSeat: 0, status: '', statusText: '', advancedRound: false };
    }
    const spoken = new Set((Array.isArray(game.roundSpokenSeats) ? game.roundSpokenSeats : []).map(Number));
    if (players.every((p) => spoken.has(Number(p.seat)))) {
        const user = players.find((p) => p.isUser);
        return {
            ok: true, reason: null, phase: 'voting', currentSpeakerSeat: 0,
            status: user ? 'waiting_user_vote' : 'vote_ready',
            statusText: user ? '请选择本轮投票目标' : '正在准备全员投票',
            advancedRound: false
        };
    }
    const currentSeat = Number(game.currentSpeakerSeat || 0);
    const currentIndex = players.findIndex((p) => Number(p.seat) === currentSeat);
    const ordered = currentIndex >= 0
        ? [...players.slice(currentIndex + 1), ...players.slice(0, currentIndex + 1)]
        : players;
    const next = ordered.find((p) => !spoken.has(Number(p.seat))) || players[0];
    const seat = Number(next.seat || 1);
    return {
        ok: true, reason: null, phase: 'playing', currentSpeakerSeat: seat,
        status: next.isUser ? 'waiting_user' : 'ready',
        statusText: next.isUser ? '等待你发言' : '等待 ' + seat + '号发言',
        advancedRound: false
    };
}

/* ---------- 8. 投票结算 ---------- */

/**
 * 收一轮的票并结算。返回 { ok, reason, votes, tally, leaders, eliminatedSeat, tiedSeats,
 *   record, phase, winner, status, statusText, currentSpeakerSeat, round, aliveCount }
 *   - 弃票的 AI 由 rng 兜一票（rng 由调用方给，不给则弃着）；
 *   - 平票无人出局；最高票唯一才出局；
 *   - 卧底全灭 -> 平民胜；活人 <= 2 -> 卧底胜；否则进下一轮。
 */
export function resolveVotes(game, aiVotes, rng) {
    if (!game || typeof game !== 'object' || !Array.isArray(game.players)) {
        return { ok: false, reason: UC_REJECT.badState };
    }
    const players = game.players.map((p) => Object.assign({}, p));
    const alive = players.filter((p) => p.alive !== false);
    const aliveSeats = new Set(alive.map((p) => Number(p.seat)));
    const user = alive.find((p) => p.isUser);
    const aiVoterSeats = alive.filter((p) => !p.isUser).map((p) => Number(p.seat));

    const byVoter = new Map();
    const userVote = game.userVote;
    if (user && userVote) {
        const voterSeat = Number(userVote.voterSeat);
        const targetSeat = Number(userVote.targetSeat);
        if (voterSeat === Number(user.seat) && aliveSeats.has(targetSeat) && voterSeat !== targetSeat) {
            byVoter.set(voterSeat, { voterSeat, targetSeat });
        }
    }
    (Array.isArray(aiVotes) ? aiVotes : []).forEach((vote) => {
        const voterSeat = Number((vote && vote.voterSeat) || 0);
        const targetSeat = Number((vote && vote.targetSeat) || 0);
        if (!aiVoterSeats.includes(voterSeat) || byVoter.has(voterSeat)) return;
        if (!aliveSeats.has(targetSeat) || voterSeat === targetSeat) return;
        byVoter.set(voterSeat, { voterSeat, targetSeat });
    });
    /* 弃票兜一票：rng 由调用方给（源里是内核自造随机挑的）。 */
    const next = rng || null;
    aiVoterSeats.forEach((voterSeat) => {
        if (byVoter.has(voterSeat)) return;
        if (!next) return;
        const targets = alive.filter((p) => Number(p.seat) !== voterSeat);
        if (!targets.length) return;
        const t = targets[Math.floor(next() * targets.length)];
        if (t) byVoter.set(voterSeat, { voterSeat, targetSeat: Number(t.seat) });
    });

    const votes = [...byVoter.values()].sort((a, b) => a.voterSeat - b.voterSeat);
    const tally = new Map();
    votes.forEach((v) => tally.set(v.targetSeat, (tally.get(v.targetSeat) || 0) + 1));
    const highest = Math.max(0, ...tally.values());
    const leaders = [...tally.entries()].filter(([, c]) => c === highest).map(([seat]) => Number(seat));
    const eliminatedSeat = highest > 0 && leaders.length === 1 ? leaders[0] : 0;
    const eliminated = eliminatedSeat
        ? players.find((p) => Number(p.seat) === eliminatedSeat) || null
        : null;
    if (eliminated) eliminated.alive = false;

    const aliveAfter = players.filter((p) => p.alive !== false);
    const undercoverAlive = aliveAfter.some((p) => p.role === 'undercover');

    let phase = 'playing';
    let winner = '';
    let status = '';
    let statusText = '';
    let currentSpeakerSeat = 0;
    let advancedRound = false;
    if (!undercoverAlive) {
        phase = 'ended'; winner = 'civilian'; status = 'ended'; statusText = '平民阵营获胜';
    } else if (aliveAfter.length <= 2) {
        phase = 'ended'; winner = 'undercover'; status = 'ended'; statusText = '卧底获胜';
    } else {
        const first = [...aliveAfter].sort((a, b) => Number(a.seat) - Number(b.seat))[0];
        phase = 'playing';
        currentSpeakerSeat = Number((first && first.seat) || 1);
        status = first && first.isUser ? 'waiting_user' : 'ready';
        statusText = first && first.isUser ? '等待你发言' : '等待 ' + currentSpeakerSeat + '号发言';
        advancedRound = true;
    }

    return {
        ok: true,
        reason: null,
        votes,
        tally: [...tally.entries()].map(([seat, count]) => ({ seat: Number(seat), count })).sort((a, b) => b.count - a.count || a.seat - b.seat),
        leaders,
        eliminatedSeat,
        tiedSeats: eliminatedSeat ? [] : leaders,
        eliminated: eliminated ? { seat: Number(eliminated.seat), name: String(eliminated.name || ''), role: String(eliminated.role || '') } : null,
        record: { round: Number(game.round || 1), votes, eliminatedSeat, tiedSeats: eliminatedSeat ? [] : leaders },
        players,
        phase,
        winner,
        status,
        statusText,
        currentSpeakerSeat,
        round: advancedRound ? Math.max(1, Number(game.round || 1)) + 1 : Number(game.round || 1),
        advancedRound,
        aliveCount: aliveAfter.length
    };
}

/** 结算文案（视图用：几号投几号 + 谁出局 / 平票）。 */
export function voteResultText(result) {
    if (!result || !result.ok) return '';
    const voteText = (result.votes || []).map((v) => v.voterSeat + '号→' + v.targetSeat + '号').join('，');
    const e = result.eliminated;
    const body = e
        ? e.seat + '号 ' + e.name + ' 出局，身份是' + (e.role === 'undercover' ? '卧底' : '平民') + '。'
        : '本轮平票（' + (result.leaders || []).map((s) => s + '号').join('、') + '），无人出局。';
    return voteText + '。' + body;
}

/* ---------- 9. 状态自检 ---------- */

/** 玩家里必须有且只有一个用户；每人身份都得在词表里（给了才算）。 */
export function isValidGame(game) {
    if (!game || typeof game !== 'object' || !Array.isArray(game.players)) {
        return { ok: false, reason: UC_REJECT.badState };
    }
    const users = game.players.filter((p) => p && p.isUser === true);
    if (users.length !== 1) return { ok: false, reason: UC_REJECT.badState };
    for (const p of game.players) {
        if (p.role && ROLES.indexOf(p.role) < 0) return { ok: false, reason: UC_REJECT.badState };
    }
    return { ok: true, reason: null };
}

/** 活着的玩家。 */
export function alivePlayers(players) {
    return (Array.isArray(players) ? players : []).filter((p) => p && p.alive !== false);
}

export default {
    PLAYER_COUNT, MAX_INVITED_CONTACTS, AI_AVATAR_PRESET_COUNT, MAX_RECENT_WORD_PAIRS,
    FALLBACK_WORD_PAIRS, FALLBACK_AI_PROFILES, ROLES, PHASES, UC_REJECT, SPEECH_LIMITS,
    normalizeWordHistory, usedWordSet, normalizeWordPair, rememberWordPair,
    normalizeContactIds, pickInvitedContacts, shuffle, seatPlayers, pickUndercoverSeat,
    buildAiProfiles, splitSpeechSegments, nextSpeaker, resolveVotes, voteResultText,
    isValidGame, alivePlayers
};
