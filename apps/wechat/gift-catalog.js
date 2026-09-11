/**
 * 微信礼物目录
 * 数据与 SVG 移植自 ovo066/kktest (KakaChat) public/gifts + src/data/gifts.js
 */

export const GIFT_CATEGORIES = Object.freeze([
  { id: 'coffee', name: '咖啡饮品' },
  { id: 'food', name: '美食餐饮' },
  { id: 'dessert', name: '甜品蛋糕' },
  { id: 'entertainment', name: '影音娱乐' },
  { id: 'classic', name: '经典礼物' },
]);

export const GIFTS = Object.freeze([
  { id: 'starbucks-latte', name: '星巴克拿铁', category: 'coffee', price: 38, desc: '一杯经典大杯拿铁', aliases: ['星巴克', '拿铁'] },
  { id: 'starbucks-frappuccino', name: '星冰乐', category: 'coffee', price: 42, desc: '冰爽星冰乐', aliases: ['星冰乐'] },
  { id: 'luckin-coffee', name: '瑞幸生椰拿铁', category: 'coffee', price: 18, desc: '生椰拿铁', aliases: ['瑞幸', '生椰拿铁'] },
  { id: 'milk-tea', name: '喜茶多肉葡萄', category: 'coffee', price: 29, desc: '满杯鲜果水果茶', aliases: ['喜茶', '奶茶'] },
  { id: 'kfc-bucket', name: 'KFC全家桶', category: 'food', price: 89, desc: '经典全家桶', aliases: ['KFC', '肯德基', '全家桶'] },
  { id: 'mcdonalds-meal', name: '麦当劳套餐', category: 'food', price: 39, desc: '巨无霸套餐', aliases: ['麦当劳'] },
  { id: 'pizza-hut', name: '必胜客披萨', category: 'food', price: 99, desc: '9寸超级至尊披萨', aliases: ['必胜客', '披萨'] },
  { id: 'haidilao', name: '海底捞代金券', category: 'food', price: 200, desc: '海底捞200元代金券', aliases: ['海底捞', '火锅'] },
  { id: 'cake', name: '生日蛋糕', category: 'dessert', price: 168, desc: '精美双层生日蛋糕', aliases: ['蛋糕', '生日蛋糕'] },
  { id: 'macarons', name: '马卡龙礼盒', category: 'dessert', price: 128, desc: '法式马卡龙12枚', aliases: ['马卡龙'] },
  { id: 'chocolate', name: 'Godiva巧克力', category: 'dessert', price: 199, desc: '松露巧克力礼盒', aliases: ['巧克力'] },
  { id: 'ice-cream', name: '哈根达斯', category: 'dessert', price: 88, desc: '迷你杯4支装', aliases: ['哈根达斯', '冰淇淋'] },
  { id: 'netflix', name: 'Netflix会员', category: 'entertainment', price: 89, desc: '一个月标准会员', aliases: ['Netflix', '奈飞'] },
  { id: 'spotify', name: 'Spotify会员', category: 'entertainment', price: 35, desc: '一个月个人会员', aliases: ['Spotify'] },
  { id: 'movie-ticket', name: '电影票', category: 'entertainment', price: 45, desc: '全国通用电影兑换券', aliases: ['电影票', '电影'] },
  { id: 'game-card', name: 'Steam充值卡', category: 'entertainment', price: 100, desc: 'Steam 100元充值卡', aliases: ['Steam', '游戏充值'] },
  { id: 'rose', name: '玫瑰花束', category: 'classic', price: 99, desc: '11朵红玫瑰', aliases: ['玫瑰', '玫瑰花'] },
  { id: 'ring', name: '戒指', category: 'classic', price: 520, desc: '精美银饰戒指', aliases: ['戒指'] },
  { id: 'perfume', name: '香水', category: 'classic', price: 299, desc: '品牌香水小样套装', aliases: ['香水'] },
  { id: 'bouquet', name: '花束', category: 'classic', price: 188, desc: '混搭鲜花', aliases: ['花束', '鲜花'] },
  { id: 'bear', name: '小熊玩偶', category: 'classic', price: 68, desc: '毛绒泰迪熊', aliases: ['小熊', '泰迪熊'] },
  { id: 'wine', name: '红酒', category: 'classic', price: 258, desc: '法国进口干红', aliases: ['红酒', '葡萄酒'] },
  { id: 'crown', name: '皇冠', category: 'classic', price: 66, desc: '闪耀皇冠头饰', aliases: ['皇冠'] },
  { id: 'star', name: '星星', category: 'classic', price: 9.9, desc: '一颗闪亮的星', aliases: ['星星'] },
]);

const BY_ID = new Map(GIFTS.map((g) => [g.id, g]));

export function getGiftById(id) {
  return BY_ID.get(String(id || '').trim()) || null;
}

export function getGiftData(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return GIFTS.find((g) => g.id === lower || g.name === raw || g.aliases.includes(raw)) || null;
}

export function getGiftImageUrl(id) {
  const gift = getGiftById(id) || getGiftData(id);
  if (!gift) return '';
  try {
    return new URL('./gifts/' + gift.id + '.svg', import.meta.url).href;
  } catch (e) {
    return '';
  }
}

export function listGiftsByCategory() {
  return GIFT_CATEGORIES.map((cat) => ({
    ...cat,
    items: GIFTS.filter((g) => g.category === cat.id),
  }));
}
