/**
 * 种族生理表与胚胎类型
 * 数值移植自 Liuuuu54/st_bs_biotracker/scripts/race_config.js
 * 纯资料，不绑定 LLM
 */

export const VIVIPAROUS_RACES = Object.freeze(["人类", "精灵", "兽耳族", "袋兽族", "哥布林", "兽人", "矮人", "半身人", "半人马", "巨人", "魅魔", "雪族", "夜叉", "妖狐", "貓又", "月兔族", "杜拉罕"]);
export const OVIPAROUS_RACES = Object.freeze(["鸟人", "植物亚人", "社会虫族", "蜥蜴人", "触手怪", "妖精", "真菌亚人", "海蛞蝓族", "龟族", "甲壳族", "宝箱怪", "阿拉克涅", "百足姬", "天狗", "深潜者", "狗头人"]);
export const OVOVIVIPAROUS_RACES = Object.freeze(["人鱼", "鱼人", "海妖", "独居虫族", "蛇人", "蛙人", "眼魔", "水母族", "海龙人", "河童", "梅杜莎"]);
export const METOVIVIPAROUS_RACES = Object.freeze(["龙族", "狮鹫族", "天使", "恶魔", "奇美拉", "麒麟", "凤凰", "白泽", "独角兽", "空鲸", "修格斯"]);
export const AMORPHOUS_RACES = Object.freeze(["史萊姆", "石像鬼", "烛灵", "人偶", "心魇", "宝石人", "奈米丛族", "元素灵", "灯神", "影魔", "活体铠甲", "伪人"]);

export const RACE_PHYSIOLOGY = Object.freeze({
  "人类": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 1,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "精灵": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 0.8,
    "breedTolerance": 0.33,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 2,
    "genderRatio": 45
  },
  "兽耳族": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1.6,
    "birthDifficulty": 0.8,
    "breedTolerance": 3,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 45,
    "genderRatio": 50
  },
  "袋兽族": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 5,
    "birthDifficulty": 0.3,
    "breedTolerance": 0.01,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 25,
    "genderRatio": 50
  },
  "哥布林": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 2.5,
    "birthDifficulty": 2,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.2,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 40,
    "genderRatio": 95
  },
  "兽人": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 1,
    "breedTolerance": 2,
    "impregnationDifficulty": 0.8,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 50,
    "genderRatio": 75
  },
  "矮人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 2,
    "breedTolerance": 1,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 2,
    "genderRatio": 60
  },
  "半身人": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 1.5,
    "breedTolerance": 2,
    "impregnationDifficulty": 0.8,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 30,
    "genderRatio": 50
  },
  "魅魔": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 0.5,
    "breedTolerance": 3,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 33,
    "genderRatio": 50
  },
  "半人马": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 0.5,
    "impregnationDifficulty": 2,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 66
  },
  "巨人": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.4,
    "birthDifficulty": 3,
    "breedTolerance": 1,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 2,
    "genderRatio": 50
  },
  "雪族": {
    "menstrualLengthRatio": 1.25,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 0.75,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 40
  },
  "夜叉": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 4,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 50,
    "genderRatio": 50
  },
  "妖狐": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 0.5,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "貓又": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 1.5,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "鸟人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 0.33,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 15,
    "genderRatio": 50
  },
  "植物亚人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 2.5,
    "birthDifficulty": 0.25,
    "breedTolerance": 1,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 6,
    "identicalProbability": 5,
    "genderRatio": null
  },
  "真菌亚人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 3.3,
    "birthDifficulty": 0.25,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.8,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 5,
    "genderRatio": null
  },
  "社会虫族": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 2.5,
    "birthDifficulty": 0.2,
    "breedTolerance": 4,
    "impregnationDifficulty": 0.2,
    "orgasmOvulationAmount": 8,
    "identicalProbability": 0,
    "genderRatio": 10
  },
  "触手怪": {
    "menstrualLengthRatio": 0.25,
    "gestationSpeciesSpeed": 5,
    "birthDifficulty": 0.2,
    "breedTolerance": 5,
    "impregnationDifficulty": 0.25,
    "orgasmOvulationAmount": 9,
    "identicalProbability": 25,
    "genderRatio": -1
  },
  "妖精": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1,
    "breedTolerance": 1,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 2,
    "genderRatio": 50
  },
  "龟族": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.625,
    "birthDifficulty": 0.3,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 2,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 15,
    "genderRatio": 50
  },
  "甲壳族": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 1.6,
    "birthDifficulty": 0.4,
    "breedTolerance": 1.6,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "蜥蜴人": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 0.8,
    "breedTolerance": 2.5,
    "impregnationDifficulty": 1.5,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 20,
    "genderRatio": null
  },
  "海蛞蝓族": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 3.3,
    "birthDifficulty": 0.25,
    "breedTolerance": 0.25,
    "impregnationDifficulty": 0.25,
    "orgasmOvulationAmount": 5,
    "identicalProbability": 30,
    "genderRatio": null
  },
  "宝箱怪": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1.67,
    "birthDifficulty": 0.6,
    "breedTolerance": 3.6,
    "impregnationDifficulty": 0.6,
    "orgasmOvulationAmount": 6,
    "identicalProbability": 66,
    "genderRatio": null
  },
  "阿拉克涅": {
    "menstrualLengthRatio": 0.75,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 1.5,
    "breedTolerance": 4,
    "impregnationDifficulty": 2,
    "orgasmOvulationAmount": 6,
    "identicalProbability": 0,
    "genderRatio": 25
  },
  "百足姬": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 3.5,
    "breedTolerance": 4,
    "impregnationDifficulty": 1.5,
    "orgasmOvulationAmount": 6,
    "identicalProbability": 0,
    "genderRatio": 40
  },
  "天狗": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 1.5,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "深潜者": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 1.2,
    "breedTolerance": 3,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 10,
    "genderRatio": 75
  },
  "人鱼": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 0.75,
    "impregnationDifficulty": 2,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "鱼人": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 2,
    "breedTolerance": 1,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 2,
    "genderRatio": 50
  },
  "海妖": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 3,
    "breedTolerance": 0.3,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 5,
    "genderRatio": 33
  },
  "水母族": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 0.2,
    "breedTolerance": 0.5,
    "impregnationDifficulty": 0.33,
    "orgasmOvulationAmount": 5,
    "identicalProbability": 50,
    "genderRatio": null
  },
  "海龙人": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 0.625,
    "birthDifficulty": 2,
    "breedTolerance": 0.4,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 25,
    "genderRatio": 66
  },
  "河童": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 1.5,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 15,
    "genderRatio": 50
  },
  "蛇人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1.2,
    "breedTolerance": 2,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 10,
    "genderRatio": 50
  },
  "蛙人": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 3.3,
    "birthDifficulty": 0.25,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.7,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 30,
    "genderRatio": null
  },
  "眼魔": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 1.25,
    "birthDifficulty": 0.5,
    "breedTolerance": 0.75,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 2,
    "genderRatio": 50
  },
  "独居虫族": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 4,
    "birthDifficulty": 0.5,
    "breedTolerance": 1,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 0,
    "genderRatio": 30
  },
  "龙族": {
    "menstrualLengthRatio": 4,
    "gestationSpeciesSpeed": 0.25,
    "birthDifficulty": 4,
    "breedTolerance": 10,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 25,
    "genderRatio": 50
  },
  "狮鹫族": {
    "menstrualLengthRatio": 3.5,
    "gestationSpeciesSpeed": 0.33,
    "birthDifficulty": 3,
    "breedTolerance": 9,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 25,
    "genderRatio": 50
  },
  "天使": {
    "menstrualLengthRatio": 13,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 2.5,
    "breedTolerance": 7,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 10,
    "genderRatio": 50
  },
  "恶魔": {
    "menstrualLengthRatio": 13,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 2.5,
    "breedTolerance": 7,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 10,
    "genderRatio": 50
  },
  "灯神": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 0.66,
    "birthDifficulty": 2,
    "breedTolerance": 6,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 0,
    "genderRatio": 50
  },
  "麒麟": {
    "menstrualLengthRatio": 1.75,
    "gestationSpeciesSpeed": 0.3,
    "birthDifficulty": 3,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "凤凰": {
    "menstrualLengthRatio": 1.75,
    "gestationSpeciesSpeed": 0.4,
    "birthDifficulty": 5,
    "breedTolerance": 0.5,
    "impregnationDifficulty": 3.5,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "白泽": {
    "menstrualLengthRatio": 1.75,
    "gestationSpeciesSpeed": 0.35,
    "birthDifficulty": 4,
    "breedTolerance": 0.3,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "独角兽": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 3.5,
    "breedTolerance": 8,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 25,
    "genderRatio": 66
  },
  "空鲸": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 0.2,
    "birthDifficulty": 5,
    "breedTolerance": 10,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 33
  },
  "史萊姆": {
    "menstrualLengthRatio": 0.25,
    "gestationSpeciesSpeed": 0.5,
    "birthDifficulty": 0.25,
    "breedTolerance": 8,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 75,
    "genderRatio": null
  },
  "石像鬼": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.4,
    "birthDifficulty": 2.5,
    "breedTolerance": 4,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": -1
  },
  "烛灵": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1.6,
    "birthDifficulty": 0.5,
    "breedTolerance": 2,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 40,
    "genderRatio": -1
  },
  "人偶": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1.5,
    "breedTolerance": 2,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 10,
    "genderRatio": -1
  },
  "心魇": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 2.5,
    "breedTolerance": 0.8,
    "impregnationDifficulty": 1,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "元素灵": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 0.5,
    "breedTolerance": 5,
    "impregnationDifficulty": 6,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": -1
  },
  "宝石人": {
    "menstrualLengthRatio": 3,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 3,
    "breedTolerance": 2,
    "impregnationDifficulty": 7,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 5,
    "genderRatio": 50
  },
  "奈米丛族": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 1,
    "breedTolerance": 6,
    "impregnationDifficulty": 7,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 1,
    "genderRatio": null
  },
  "奇美拉": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.4,
    "birthDifficulty": 4,
    "breedTolerance": 12,
    "impregnationDifficulty": 4,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "影魔": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 0.75,
    "birthDifficulty": 0.6,
    "breedTolerance": 5,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 0,
    "identicalProbability": 33,
    "genderRatio": 50
  },
  "月兔族": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 2,
    "birthDifficulty": 0.6,
    "breedTolerance": 2.5,
    "impregnationDifficulty": 0.4,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 30,
    "genderRatio": 30
  },
  "狗头人": {
    "menstrualLengthRatio": 0.5,
    "gestationSpeciesSpeed": 2.5,
    "birthDifficulty": 0.4,
    "breedTolerance": 1.2,
    "impregnationDifficulty": 0.3,
    "orgasmOvulationAmount": 3,
    "identicalProbability": 20,
    "genderRatio": 50
  },
  "梅杜莎": {
    "menstrualLengthRatio": 1.5,
    "gestationSpeciesSpeed": 0.7,
    "birthDifficulty": 1.5,
    "breedTolerance": 1,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 20
  },
  "修格斯": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.3,
    "birthDifficulty": 2,
    "breedTolerance": 12,
    "impregnationDifficulty": 5,
    "orgasmOvulationAmount": 2,
    "identicalProbability": 50,
    "genderRatio": null
  },
  "活体铠甲": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1.5,
    "birthDifficulty": 1.5,
    "breedTolerance": 2,
    "impregnationDifficulty": 0.5,
    "orgasmOvulationAmount": 4,
    "identicalProbability": 15,
    "genderRatio": -1
  },
  "伪人": {
    "menstrualLengthRatio": 1,
    "gestationSpeciesSpeed": 1,
    "birthDifficulty": 1,
    "breedTolerance": 2,
    "impregnationDifficulty": 3,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 33,
    "genderRatio": 50
  },
  "杜拉罕": {
    "menstrualLengthRatio": 2,
    "gestationSpeciesSpeed": 0.8,
    "birthDifficulty": 1,
    "breedTolerance": 3,
    "impregnationDifficulty": 2.5,
    "orgasmOvulationAmount": 1,
    "identicalProbability": 5,
    "genderRatio": 50
  }
});

export const EMBRYO_TYPES = Object.freeze(['胎生', '卵生', '卵胎生', '胎转卵生', '不定型']);

const TYPE_BY_RACE = new Map();
for (const n of VIVIPAROUS_RACES) TYPE_BY_RACE.set(n, '胎生');
for (const n of OVIPAROUS_RACES) TYPE_BY_RACE.set(n, '卵生');
for (const n of OVOVIVIPAROUS_RACES) TYPE_BY_RACE.set(n, '卵胎生');
for (const n of METOVIVIPAROUS_RACES) TYPE_BY_RACE.set(n, '胎转卵生');
for (const n of AMORPHOUS_RACES) TYPE_BY_RACE.set(n, '不定型');

export function listKnownRaces() {
  return Object.keys(RACE_PHYSIOLOGY);
}

export function parseRaceParts(race) {
  const raw = String(race || '').trim();
  if (!raw) return ['人类'];
  const cleaned = raw.replace(/\[[^\]]*\]/g, ' ');
  const parts = cleaned.split(/[·•、/|,]+/).map((s) => s.trim()).filter(Boolean);
  const known = listKnownRaces();
  const hit = [];
  for (const part of parts) {
    if (RACE_PHYSIOLOGY[part]) hit.push(part);
    else {
      const found = known.find((n) => part.includes(n) || n.includes(part));
      if (found) hit.push(found);
    }
  }
  return hit.length ? [...new Set(hit)] : ['人类'];
}

export function getRaceProfile(race) {
  const name = String(race || '').trim() || '人类';
  if (RACE_PHYSIOLOGY[name]) return RACE_PHYSIOLOGY[name];
  const parts = parseRaceParts(name);
  let best = RACE_PHYSIOLOGY['人类'];
  let lowest = Number.POSITIVE_INFINITY;
  for (const part of parts) {
    const p = RACE_PHYSIOLOGY[part];
    if (!p) continue;
    const speed = Number(p.gestationSpeciesSpeed);
    if (Number.isFinite(speed) && speed < lowest) {
      lowest = speed;
      best = p;
    }
  }
  return best;
}

export function getEmbryoTypeByRace(race) {
  const parts = parseRaceParts(race);
  let dominant = parts[0] || '人类';
  let lowest = Number.POSITIVE_INFINITY;
  for (const part of parts) {
    const p = RACE_PHYSIOLOGY[part];
    const speed = Number(p?.gestationSpeciesSpeed);
    if (Number.isFinite(speed) && speed < lowest) {
      lowest = speed;
      dominant = part;
    }
  }
  return TYPE_BY_RACE.get(dominant) || '胎生';
}

export const EMBRYO_LORE = Object.freeze({
  胎生: '胎生：未受精时周期性内膜脱落；胚胎靠胎盘与母体循环交换营养；新生儿较脆弱，分娩难度受胎位影响。',
  卵生: '卵生：周期性排出未受精空卵；能量主要用于卵黄与蛋壳；卵在体外孵化，幼体相对自立。',
  卵胎生: '卵胎生：卵在体内发育，临产前后宫内破卵；娩出的是可活动幼体，多胎时宫内竞争更明显。',
  胎转卵生: '胎转卵生：孕期从胎盘供能转为卵黄储备，晚期卵体巨大化，分娩缓慢沉重。',
  不定型: '不定型：无可常规月经排泄；胚胎形态随阶段重组，分娩方式不规则。',
});
