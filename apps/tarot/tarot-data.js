/* ========================================================
 * 塔罗 (Tarot) App — 数据层
 * 78 张韦特牌(大阿卡那 22 + 小阿卡那 56)、5 种牌阵、抽牌存档
 * 纯本地规则: 随机抽牌, AI 解说由角色在剧情中自然输出 (<TAROT> 协议)
 * ======================================================== */
'use strict';

// 大阿卡那 22 张: 编号/名称/正位关键词/逆位关键词/象征
export const MAJOR_ARCANA = [
  { id: 0,  name: '愚者',   up: '自由·冒险·天真', down: '鲁莽·轻率·逃避', symbol: '新征程的起点, 背包与白犬, 悬崖边缘' },
  { id: 1,  name: '魔术师', up: '意志·创造·沟通', down: '欺骗·浪费·优柔', symbol: '手举魔杖, 桌上四大元素, 无限符号' },
  { id: 2,  name: '女祭司', up: '直觉·静观·神秘', down: '冷漠·失衡·隐藏', symbol: '怀抱书卷, 黑白双柱, 月冠与石榴' },
  { id: 3,  name: '皇后',   up: '丰饶·滋养·感受', down: '依赖·占有·空耗', symbol: '麦田与王座, 金星符号, 自然的丰盛' },
  { id: 4,  name: '皇帝',   up: '权威·秩序·保护', down: '固执·专断·僵硬', symbol: '宝座上的公羊头, 山峦与红袍' },
  { id: 5,  name: '教皇',   up: '信仰·传统·指引', down: '教条·盲从·虚伪', symbol: '三重冠与交叉钥匙, 跪拜者' },
  { id: 6,  name: '恋人',   up: '结合·选择·和谐', down: '纠结·分离·背德', symbol: '天使与亚当夏娃, 生命之树与智慧之树' },
  { id: 7,  name: '战车',   up: '意志·前进·胜利', down: '失控·受阻·蛮干', symbol: '双狮拉车, 星冠与护甲' },
  { id: 8,  name: '力量',   up: '勇气·耐心·柔韧', down: '软弱·自我怀疑', symbol: '少女抚狮, 无限符号, 温柔驯服野性' },
  { id: 9,  name: '隐者',   up: '内省·独处·求索', down: '孤僻·逃避·自我封闭', symbol: '提灯拄杖, 山巅雪峰, 六芒星灯' },
  { id: 10, name: '命运之轮', up: '转折·机缘·运势', down: '厄运·停滞·抗拒变化', symbol: '轮中刻满符号, 四神兽环绕' },
  { id: 11, name: '正义',   up: '公正·平衡·责任', down: '偏颇·逃避责任', symbol: '持剑与天秤, 红袍, 法庭' },
  { id: 12, name: '倒吊人', up: '牺牲·换位·通透', down: '僵持·无谓牺牲', symbol: '倒悬一足, 光环, 逆知' },
  { id: 13, name: '死神',   up: '结束·蜕变·新生', down: '抗拒改变·停滞', symbol: '白马骑士, 黑旗白玫瑰, 新生晨曦' },
  { id: 14, name: '节制',   up: '调和·耐心·中道', down: '失衡·急躁·挥霍', symbol: '双杯水流, 一足踏水一足踏地' },
  { id: 15, name: '恶魔',   up: '束缚·欲望·执念', down: '挣脱·觉醒·释然', symbol: '倒五芒星, 铁链松垮, 恶魔与锁链的男女' },
  { id: 16, name: '高塔',   up: '剧变·崩塌·警醒', down: '灾后重建·解脱', symbol: '雷击之塔, 坠落者与火' },
  { id: 17, name: '星星',   up: '希望·疗愈·灵感', down: '失望·迷惘·信心缺失', symbol: '八芒星, 双壶流水, 裸女于河畔' },
  { id: 18, name: '月亮',   up: '幻象·潜意识·不安', down: '拨云见日·清醒', symbol: '双塔双犬, 巨蟹, 月光与露' },
  { id: 19, name: '太阳',   up: '成功·喜悦·活力', down: '自满·延误·虚妄快乐', symbol: '孩童白马, 向日葵, 阳光普照' },
  { id: 20, name: '审判',   up: '觉醒·宽恕·召唤', down: '悔恨·再审判·自我否定', symbol: '吹号天使, 棺中三人站起' },
  { id: 21, name: '世界',   up: '圆满·完成·整合', down: '未竟·停滞·不完整', symbol: '舞蹈者于花环之中, 四元素' }
];

// 小阿卡那 56 张: 四花色 × 14 (Ace + 2-10 + 侍从 骑士 王后 国王)
const SUITS = [
  { name: '权杖', element: '火', meaning: '行动·热情·创造', color: '#f97316' },
  { name: '圣杯', element: '水', meaning: '情感·关系·直觉', color: '#38bdf8' },
  { name: '宝剑', element: '风', meaning: '思维·冲突·真相', color: '#e2e8f0' },
  { name: '星币', element: '土', meaning: '物质·工作·身体', color: '#facc15' }
];
const MINOR_RANKS = [
  { n: 1,  label: 'Ace', up: '新起点·种子·潜能', down: '延迟·虚耗·错失' },
  { n: 2,  label: '2',  up: '权衡·互补·选择', down: '僵局·两难·失衡' },
  { n: 3,  label: '3',  up: '协作·成长·果实', down: '延误·阻力·内耗' },
  { n: 4,  label: '4',  up: '稳定·休整·堡垒', down: '停滞·守旧·僵化' },
  { n: 5,  label: '5',  up: '动荡·失落·考验', down: '修复·释怀·转弯' },
  { n: 6,  label: '6',  up: '胜利·馈赠·和谐', down: '失衡·傲慢·吝啬' },
  { n: 7,  label: '7',  up: '坚持·评估·谋划', down: '放弃·怀疑·僵持' },
  { n: 8,  label: '8',  up: '快速·行动·跃迁', down: '迟滞·返工·疲惫' },
  { n: 9,  label: '9',  up: '近成·独行·操劳', down: '孤注·失望·反噬' },
  { n: 10, label: '10', up: '圆满·终点·收获', down: '超载·回力·未竟' },
  { n: 11, label: '侍从', up: '好奇·消息·开端', down: '幼稚·拖延·分心' },
  { n: 12, label: '骑士', up: '冲刺·行动·直接', down: '鲁莽·冒进·失控' },
  { n: 13, label: '王后', up: '成熟·包容·内蕴', down: '多虑·依赖·情绪化' },
  { n: 14, label: '国王', up: '掌控·权威·务实', down: '固执·专权·僵化' }
];

// 拼接成 78 张完整牌组 (含 _major 标记)
export function buildFullDeck() {
  const deck = MAJOR_ARCANA.map(m => ({
    key: `major_${m.id}`, name: m.name, major: true,
    up: m.up, down: m.down, symbol: m.symbol,
    color: '#a78bfa'
  }));
  for (const suit of SUITS) {
    for (const r of MINOR_RANKS) {
      deck.push({
        key: `minor_${suit.name}_${r.label}`,
        name: `${suit.name}${r.label === 'Ace' ? '' : '·' + r.label}`,
        major: false, suit: suit.name, element: suit.element,
        up: r.up, down: r.down, color: suit.color
      });
    }
  }
  return deck;
}

// 牌阵定义: 名称 / 布局 / 每位的含义
export const SPREADS = {
  single: {
    name: '单张指引', desc: '一张牌回答当下的核心问题', 
    positions: [{ label: '指引', x: 50, y: 40 }]
  },
  tri: {
    name: '三张·过去现在未来', desc: '过去 / 现在 / 未来',
    positions: [
      { label: '过去', x: 20, y: 50 },
      { label: '现在', x: 50, y: 50 },
      { label: '未来', x: 80, y: 50 }
    ]
  },
  cross: {
    name: '凯尔特十字', desc: '现状·阻碍·潜意识·根基·过去·未来·自我·环境·希望·结果',
    positions: [
      { label: '现状', x: 50, y: 50 },
      { label: '阻碍', x: 50, y: 50 },
      { label: '潜意识', x: 30, y: 50 },
      { label: '根基', x: 50, y: 30 },
      { label: '过去', x: 50, y: 70 },
      { label: '未来', x: 70, y: 50 },
      { label: '自我', x: 30, y: 20 },
      { label: '环境', x: 70, y: 20 },
      { label: '希望', x: 30, y: 80 },
      { label: '结果', x: 70, y: 80 }
    ]
  },
  pyramid: {
    name: '金字塔', desc: '发端·发展·结果',
    positions: [
      { label: '发端', x: 50, y: 30 },
      { label: '发展·左', x: 30, y: 65 },
      { label: '发展·右', x: 70, y: 65 },
      { label: '结果', x: 50, y: 88 }
    ]
  },
  heart: {
    name: '心形·情感', desc: '你对 TA 的感知 / TA 对你的感知 / 你们的牵绊 / 心之所向',
    positions: [
      { label: '你对 TA', x: 35, y: 30 },
      { label: 'TA 对你', x: 65, y: 30 },
      { label: '牵绊', x: 50, y: 55 },
      { label: '心之所向', x: 50, y: 80 }
    ]
  }
};

// 抽牌 (不重复 + 可逆位)
export function drawCards(spreadKey, opts = {}) {
  const spread = SPREADS[spreadKey] || SPREADS.single;
  const deck = buildFullDeck();
  const shuffled = [...deck].sort(() => Math.random() - 0.5);
  const revChance = opts.revChance ?? 0.3;
  const count = spread.positions.length;
  const drawn = [];
  for (let i = 0; i < count; i++) {
    const card = shuffled[i];
    const reversed = Math.random() < revChance;
    drawn.push({ ...card, reversed, position: spread.positions[i] });
  }
  return { spread: SPREADS[spreadKey], cards: drawn };
}

// 生成 AI 可识别的占卜协议 (AI 回复 <TAROT> 标签即被捕获渲染)
export function buildTarotInjection(draw) {
  const list = draw.cards.map((c, i) =>
    `${i + 1}.[${c.position.label}] ${c.name}（${c.reversed ? '逆位' : '正位'}：${c.reversed ? c.down : c.up}）`
  ).join('\n');
  return `【塔罗占卜结果·${draw.spread.name}】\n${list}\n请以角色的口吻为对方解读这副牌, 自然融入剧情, 不要提及这是系统注入。`;
}

export default {
  buildFullDeck, SPREADS, drawCards, buildTarotInjection, MAJOR_ARCANA
};