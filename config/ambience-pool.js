/* ========================================================
 *  RubyPhone · 氛围池（B1）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   副模型写正文时最容易退化成两条路：要么**不写环境**（只剩对话，像在看剧本），
 *   要么**每句都写环境**（「阳光透过窗帘洒在她脸上」连着出现五次）。两种都不好，
 *   但它们不是「模型不行」—— 是**没有给它可选的东西**：没有池子，它就只能从
 *   训练里最顺手的那几个意象里挑，而那批意象恰恰是最油的。
 *
 *   本模块给的是**一份被写清楚的池子**：十类环境 × 每类若干种具体形态，
 *   每条都带「**用在**」（什么场合该用）与「**写法**」（白描写法的示范）。
 *   关键在后者：只给「雨天」两个字，模型还是会写「细雨如丝」；
 *   给它一句示范的白描，它才有得抄。
 *
 * 【为什么不写成「随机取一条」】
 *   环境不是贴纸。随机撒的后果是「咖啡馆的雨」与「主角在医院」同框。
 *   故本模块只提供 **筛选 + 去重 + 有界**，把「选哪条」交给调用方的语境判断：
 *     · `pickAmbience` 按标签/排除面筛；
 *     · `ambienceSpan` 记住**本场用过哪些**，同一场里不重复（跨场可复用）——
 *       因为「同场重复」才是读者会注意到的油，「隔两场再见」是正常的。
 *
 * 【三态互不同形】
 *   `picked`（真选到了）/ `filtered`（池里有，但被排除面挡掉）/ `exhausted`
 *   （这一类在本场已用完）。把 `exhausted` 报成 `filtered`，调用方会去调排除面
 *   （没用）；把 `filtered` 报成 `exhausted`，它会以为「这一类天生没有」。
 * ============================================================ */

/** 十类氛围。`id` 是稳定键（不许改名：调用方与卡侧都按它引）。 */
export const AMBIENCE_KINDS = Object.freeze([
    { id: 'weather', label: '天候' },
    { id: 'light', label: '光' },
    { id: 'sound', label: '声' },
    { id: 'smell', label: '气味' },
    { id: 'touch', label: '触感' },
    { id: 'place', label: '场所' },
    { id: 'season', label: '时令' },
    { id: 'city', label: '城市' },
    { id: 'crowd', label: '人群' },
    { id: 'object', label: '物件' }
]);

/** 池子：每类若干条，每条必带 `used`（用在什么场合）与 `how`（白描写法的示范）。
 *  这份表是**数据**，不是逻辑 —— 加条目不需要碰任何函数。 */
export const AMBIENCE_POOL = Object.freeze({
    weather: [
        { id: 'drizzle', label: '细雨', used: '要写「不想走」的拖延感', how: '雨不大，落在伞面上是一声一声的，不是一片的' },
        { id: 'downpour', label: '骤雨', used: '要写「躲」与「共处一室」', how: '雨砸在铁皮雨棚上，说话得提高半度' },
        { id: 'after-rain', label: '雨停', used: '要写「刚才那件事过去了没」', how: '地上还是湿的，鞋跟踩过去印出一串深色' },
        { id: 'heatwave', label: '闷热', used: '要写烦躁与衣料贴身', how: '空气不动，衬衫背上一小片深色慢慢扩大' },
        { id: 'cold-snap', label: '骤冷', used: '要写「话说出口会有白气」', how: '吸气时鼻梁发紧，呼出来的白气一散就没了' },
        { id: 'wind', label: '风', used: '要写「话被吹散」或遮掩', how: '风从巷口灌进来，把没说完的半句顶了回去' }
    ],
    light: [
        { id: 'morning-low', label: '低角度晨光', used: '要写「刚开始」', how: '光是从地板上爬过来的，先到桌脚，再到杯子' },
        { id: 'dusk-orange', label: '黄昏橘光', used: '要写「来不及了」', how: '橘色只停在窗台那一截，再往里就灰了' },
        { id: 'neon', label: '霓虹', used: '要写城市夜里的廉价与不睡', how: '红的绿的映在积水里，被车碾碎了又拼回去' },
        { id: 'screen-glow', label: '屏幕光', used: '要写「两人其实都没在看屏幕」', how: '手机屏的白光把下巴照得发青，谁都没去关' },
        { id: 'single-bulb', label: '一盏孤灯', used: '要写局促与坦白', how: '灯泡在头顶，桌子中间亮，四边全黑着' },
        { id: 'shadow-shift', label: '影子挪位', used: '要写「时间过去了，没人说话」', how: '窗框的影子从桌沿挪到了椅子上' }
    ],
    sound: [
        { id: 'street-far', label: '远处的街声', used: '要写「外面在过日子」', how: '隔着一层玻璃，喇叭声是闷的，像在水里' },
        { id: 'kettle', label: '水壶响', used: '要写「有人在为对方做点什么」', how: '壶盖跳了两下，然后是咕嘟声盖过说话声' },
        { id: 'footsteps', label: '脚步由远及近', used: '要写「等他/她来」', how: '脚步声在楼道里一顿一顿，到门口停住，又响了一下' },
        { id: 'tv-through-wall', label: '隔壁电视', used: '要写「别人的日常」', how: '隔墙有人笑，笑到一半被按掉了' },
        { id: 'silence-thick', label: '静得发沉', used: '要写「该说点什么」', how: '冰箱嗡一声，两个人都像是被吓了一跳' },
        { id: 'music-elsewhere', label: '别处放歌', used: '要写「这情绪是别人给的」', how: '副歌从楼下车里飘上来，只听得见一半' }
    ],
    smell: [
        { id: 'rain-on-asphalt', label: '雨打沥青味', used: '雨后的街', how: '一股土腥气从下水道口顶上来' },
        { id: 'kitchen-oil', label: '油烟', used: '要写家与将就', how: '走廊里全是炒过头的油烟，回自己屋还得闻一会儿' },
        { id: 'detergent', label: '洗衣粉味', used: '要写「离得很近」', how: '她袖子上的洗衣粉味比话先到' },
        { id: 'hospital', label: '消毒水', used: '要写「这不是能久留的地方」', how: '消毒水味黏在鼻腔里，出了门还散不掉' },
        { id: 'old-paper', label: '旧纸与灰', used: '要写被搁置的东西', how: '翻开时浮起来一层灰，闻着是晒干的草' },
        { id: 'cheap-perfume', label: '便宜香水', used: '要写刻意与不熟练', how: '香水喷多了，前调冲得人想偏头' }
    ],
    touch: [
        { id: 'shirt-cuff', label: '扯住袖口', used: '要写「别走」但不说出口', how: '她手指虚虚捏住他袖口，松了又不放' },
        { id: 'cold-hands', label: '手很凉', used: '要写「刚在外面站了很久」', how: '他碰到她手背，凉得像刚摸过铁' },
        { id: 'hand-on-back', label: '手压在背上', used: '要写安抚而不解释', how: '他掌心整个压在她背上，不动，只是压着' },
        { id: 'elbow-brush', label: '手肘擦过', used: '要写没说出口的那点意思', how: '两个人同时去够菜单，手肘撞了一下，谁都没缩' },
        { id: 'weight-lean', label: '肩膀承重', used: '要写累与信', how: '她往他那边靠了靠，他肩膀沉了半寸，没让开' },
        { id: 'collar-straighten', label: '理一下衣领', used: '要写「要出门了」', how: '她伸手把他领子翻正，指尖在颈侧停了一秒' }
    ],
    place: [
        { id: 'stairwell', label: '楼道', used: '要写「话只能在这儿说」', how: '声控灯亮一下又灭，两人站在半亮里' },
        { id: 'rooftop', label: '天台', used: '要写退无可退', how: '风比楼下大，说话得侧着头' },
        { id: 'night-stall', label: '夜市摊', used: '要写「热闹里说不出口」', how: '塑料凳少一只角，坐下得侧着' },
        { id: 'empty-classroom', label: '空教室', used: '要写「不该在这儿」', how: '日光灯有一根在闪，桌上还留着粉笔灰' },
        { id: 'hospital-corridor', label: '医院走廊', used: '要写等结果', how: '长椅上坐满了不说话的人，号屏跳一次，一片人抬头' },
        { id: 'convenience', label: '便利店', used: '要写凌晨与将就', how: '关东煮的锅在玻璃后冒着白汽，店员在补货' }
    ],
    season: [
        { id: 'early-spring', label: '开春', used: '要写「还没暖起来」', how: '柳条先绿了，风还是冬天的那个风' },
        { id: 'plum-rain', label: '梅雨', used: '要写「什么都晾不干」', how: '衣服晾三天还是潮的，贴在身上发闷' },
        { id: 'late-autumn', label: '深秋', used: '要写「散」', how: '风一起，银杏叶铺得台阶看不出边' },
        { id: 'first-frost', label: '初霜', used: '要写「第一次觉得冷」', how: '车顶一层白，太阳一出来就化成水痕' },
        { id: 'year-end', label: '年关', used: '要写「又要过一年」', how: '超市门口的红纸贴得比去年早' },
        { id: 'dog-days', label: '三伏', used: '要写「什么都不想干」', how: '蝉从早上五点叫到天黑，中间不歇' }
    ],
    city: [
        { id: 'county-town', label: '县城', used: '要写「小到瞒不住」', how: '一条主街走到头，三家店的人互相认识' },
        { id: 'old-block', label: '筒子楼', used: '要写住得近但心不近', how: '一层楼共一个水房，谁家几点起全楼都知道' },
        { id: 'new-district', label: '新区', used: '要写空与亮', how: '马路宽得能并排走六辆车，路灯亮着，一个人也没有' },
        { id: 'night-market-street', label: '大排档一条街', used: '要写烟火与将就', how: '塑料布棚子连成一排，油烟在灯下是白的' },
        { id: 'train-station', label: '站前', used: '要写「要走的人」', how: '拉杆箱轮子在水泥地上咯咯响，一直响到检票口' },
        { id: 'riverside', label: '江边', used: '要写「能说真心话的地方」', how: '水声盖住了半句，正好可以不重复' }
    ],
    crowd: [
        { id: 'rush-hour', label: '下班潮', used: '要写「在人堆里找一个人」', how: '出站的人像水一样溢出来，逆着走要侧身' },
        { id: 'empty-table', label: '一桌人都低头', used: '要写「没人接话」', how: '转盘上的菜转了一圈，没人夹' },
        { id: 'two-people', label: '只有两个人', used: '要写「这下躲不掉了」', how: '包厢里就他俩，空调声比说话声大' },
        { id: 'party-edge', label: '聚会边上', used: '要写在场却不在局里', how: '别人在划拳，他端着杯子站在阳台门口' },
        { id: 'queue', label: '排队', used: '要写「只能闲聊」', how: '前面还有七八个人，两个人有一搭没一搭地说' },
        { id: 'funeral-crowd', label: '白事上的人', used: '要写关系与远近', how: '来的人按辈分站，谁站哪儿一看就明白' }
    ],
    object: [
        { id: 'half-cup', label: '喝了一半的杯子', used: '要写「话没说完」', how: '茶水凉了，杯壁上留了一圈茶渍' },
        { id: 'phone-face-down', label: '屏幕朝下的手机', used: '要写「有人不想被看见」', how: '手机扣在桌上，震了一下，谁都没去翻' },
        { id: 'umbrella-one', label: '一把伞', used: '要写「得靠近」', how: '伞就那么宽，两个人都往中间挪了一点' },
        { id: 'old-photo', label: '旧照片', used: '要写「回不去了」', how: '边角卷了，背面还写着字，没翻过来' },
        { id: 'key-single', label: '一把钥匙', used: '要写关系的许可', how: '钥匙被他放在桌上推过去，没说是哪儿的' },
        { id: 'receipt', label: '一张单据', used: '要写「有笔账」', how: '纸被折了两道，展开得抚平才看得清' }
    ]
});

/** 全部条目拍平（带 kind）。 */
function allEntries() {
    const out = [];
    for (const kind of AMBIENCE_KINDS) {
        for (const item of AMBIENCE_POOL[kind.id] || []) {
            out.push({
                kind: kind.id, kindLabel: kind.label, id: item.id,
                label: item.label, used: item.used, how: item.how
            });
        }
    }
    return out;
}

/** 池子规模（自证用：48 种是这份数据的对外承诺，不许悄悄缩水）。 */
export function ambienceCount() {
    return allEntries().length;
}

/**
 * 从池子里取一条。
 *
 * @param {{kind?:string, exclude?:string[]|Set<string>, usedInScene?:string[]|Set<string>, seed?:number}} opts
 * @returns {{state:string, pick:object|null, why:string}}
 *   `state`：`picked` / `filtered` / `exhausted`（三态互不同形）。
 */
export function pickAmbience(opts = {}) {
    const kindId = String(opts.kind ?? '').trim();
    const exclude = new Set((opts.exclude instanceof Set ? Array.from(opts.exclude) : (opts.exclude || [])).map(String));
    const usedInScene = new Set((opts.usedInScene instanceof Set ? Array.from(opts.usedInScene) : (opts.usedInScene || [])).map(String));
    const pool = kindId
        ? (AMBIENCE_KINDS.some((k) => k.id === kindId) ? (AMBIENCE_POOL[kindId] || []) : [])
        : allEntries();
    if (kindId && !AMBIENCE_KINDS.some((k) => k.id === kindId)) {
        return { state: 'filtered', pick: null, why: '不认识的类：' + kindId };
    }
    const keyOf = (entry) => (entry.kind ? entry.kind + ':' : '') + entry.id;
    const candidates = pool.map((item) => (item.kind
        ? item
        : { kind: kindId, kindLabel: (AMBIENCE_KINDS.find((k) => k.id === kindId) || {}).label || '', id: item.id, label: item.label, used: item.used, how: item.how }));
    const notExcluded = candidates.filter((e) => !exclude.has(keyOf(e)) && !exclude.has(e.id));
    if (!notExcluded.length) {
        return { state: 'filtered', pick: null, why: '这一类全部被排除面挡掉（' + candidates.length + ' 条）' };
    }
    const fresh = notExcluded.filter((e) => !usedInScene.has(keyOf(e)) && !usedInScene.has(e.id));
    if (!fresh.length) {
        return { state: 'exhausted', pick: null, why: '本场已用尽这一类（' + notExcluded.length + ' 条）' };
    }
    /* 选择本身**不是随机的**：不传 seed 就按池内顺序取第一条 ——
     *  池子的顺序就是「常用度」的顺序（作者排的），随机撒只会让环境与场景脱节。
     *  传 seed 时按 seed 取模，供需要变体的调用方使用（同一 seed 必得同一条）。 */
    const seed = Number.isFinite(opts.seed) ? Math.abs(Math.floor(opts.seed)) : 0;
    const pick = fresh[seed % fresh.length];
    return { state: 'picked', pick: pick, why: '' };
}

/** 本场记录：把已用过的 key 记下来（供下一句去重）。同一场里不许重复。 */
export function ambienceSpan(initial = []) {
    const used = new Set((initial || []).map(String));
    return {
        used: used,
        keys: () => Array.from(used),
        mark: (entry) => {
            if (!entry || !entry.id) return false;
            const key = (entry.kind ? entry.kind + ':' : '') + entry.id;
            if (used.has(key)) return false;   // 已记过 ⇒ 如实报 false（不假装记上了）
            used.add(key);
            return true;
        },
        has: (entry) => !!entry && used.has((entry.kind ? entry.kind + ':' : '') + entry.id)
    };
}

/** 一行读数（诊断 / 提示）。三态各占一格。 */
export function ambienceLine(result, label = '氛围') {
    if (!result || typeof result !== 'object') return label + '：无读数';
    if (result.state === 'picked') return label + '：' + result.pick.kindLabel + '·' + result.pick.label;
    if (result.state === 'exhausted') return label + '：本场已用尽 —— ' + result.why;
    return label + '：无可用条目 —— ' + result.why;
}

export default {
    AMBIENCE_KINDS, AMBIENCE_POOL,
    ambienceCount, pickAmbience, ambienceSpan, ambienceLine
};