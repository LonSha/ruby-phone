// 病症库数据 (LA-0.6.84 medical-core 提取, 140 条)
export const categories = [
  {
    "id": "respiratory",
    "label": "呼吸系统"
  },
  {
    "id": "cardiovascular",
    "label": "心血管"
  },
  {
    "id": "digestive",
    "label": "消化系统"
  },
  {
    "id": "hepatobiliary",
    "label": "肝胆"
  },
  {
    "id": "renal_urinary",
    "label": "泌尿与肾脏"
  },
  {
    "id": "endocrine_metabolic",
    "label": "内分泌与代谢"
  },
  {
    "id": "neurological",
    "label": "神经"
  },
  {
    "id": "psychiatric",
    "label": "精神心理"
  },
  {
    "id": "musculoskeletal",
    "label": "骨骼与关节"
  },
  {
    "id": "rheumatic_immune",
    "label": "风湿免疫"
  },
  {
    "id": "dermatological",
    "label": "皮肤"
  },
  {
    "id": "ophthalmology",
    "label": "眼科"
  },
  {
    "id": "ent",
    "label": "耳鼻喉"
  },
  {
    "id": "infectious",
    "label": "感染性疾病"
  },
  {
    "id": "oncology",
    "label": "肿瘤"
  },
  {
    "id": "hematologic",
    "label": "血液系统"
  },
  {
    "id": "gynecological",
    "label": "妇产科"
  },
  {
    "id": "urology",
    "label": "男科"
  },
  {
    "id": "pediatric",
    "label": "儿科"
  },
  {
    "id": "other",
    "label": "其他"
  }
];

export const illnesses = [
  {
    "id": "cold",
    "name": "感冒",
    "category": "respiratory",
    "intro": "上呼吸道常见自限性感染，由多种病毒引起。",
    "stages": [
      {
        "stage": "初期",
        "desc": "喉咙发痒、鼻塞初现"
      },
      {
        "stage": "发作期",
        "desc": "发热咳嗽、乏力"
      },
      {
        "stage": "恢复期",
        "desc": "症状渐退、仍有咳嗽"
      }
    ]
  },
  {
    "id": "flu",
    "name": "流感",
    "category": "respiratory",
    "intro": "流感病毒感染所致的急性呼吸道传染病，全身症状较重。",
    "stages": [
      {
        "stage": "突发高热",
        "desc": "骤起高热、全身酸痛"
      },
      {
        "stage": "极期",
        "desc": "高热剧烈头痛、乏力"
      },
      {
        "stage": "恢复期",
        "desc": "退热、咳嗽迁延"
      }
    ]
  },
  {
    "id": "pharyngitis",
    "name": "咽炎",
    "category": "respiratory",
    "intro": "咽部黏膜及淋巴组织的炎症，分急性与慢性。",
    "stages": [
      {
        "stage": "急性",
        "desc": "咽痛、吞咽困难"
      },
      {
        "stage": "慢性",
        "desc": "咽干、异物感"
      }
    ]
  },
  {
    "id": "allergic_rhinitis",
    "name": "过敏性鼻炎",
    "category": "respiratory",
    "intro": "接触过敏原后由免疫反应引起的鼻黏膜炎症。",
    "stages": [
      {
        "stage": "轻度间歇",
        "desc": "偶发喷嚏、流涕，不影响睡眠"
      },
      {
        "stage": "中重度",
        "desc": "频繁发作、鼻塞明显，影响日常"
      }
    ]
  },
  {
    "id": "asthma",
    "name": "支气管哮喘",
    "category": "respiratory",
    "intro": "气道慢性炎症导致的可逆性气流受限，反复喘息。",
    "stages": [
      {
        "stage": "轻度持续",
        "desc": "偶有症状、夜间可醒"
      },
      {
        "stage": "中度持续",
        "desc": "每日发作、影响活动睡眠"
      },
      {
        "stage": "重度",
        "desc": "频繁夜间发作、活动受限"
      },
      {
        "stage": "危重急性发作",
        "desc": "喘憋明显、缺氧，需紧急处理"
      }
    ]
  },
  {
    "id": "copd",
    "name": "慢性阻塞性肺疾病",
    "category": "respiratory",
    "intro": "以持续气流受限为特征的进行性肺病，多与吸烟相关。",
    "stages": [
      {
        "stage": "GOLD1 轻度",
        "desc": "肺功能轻度下降、偶有咳嗽"
      },
      {
        "stage": "GOLD2 中度",
        "desc": "活动后气短明显"
      },
      {
        "stage": "GOLD3 重度",
        "desc": "轻微活动即喘、频繁急性加重"
      },
      {
        "stage": "GOLD4 极重度",
        "desc": "静息也喘、呼吸衰竭风险"
      }
    ]
  },
  {
    "id": "pneumonia",
    "name": "肺炎",
    "category": "respiratory",
    "intro": "肺实质的感染性炎症，可由细菌、病毒等引起。",
    "stages": [
      {
        "stage": "轻症",
        "desc": "发热咳嗽、无缺氧"
      },
      {
        "stage": "中重度",
        "desc": "高热、气促、影像实变"
      },
      {
        "stage": "重症",
        "desc": "低氧、低血压，需监护"
      }
    ]
  },
  {
    "id": "covid",
    "name": "新型冠状病毒感染",
    "category": "respiratory",
    "intro": "新冠病毒引起的呼吸道传染病，从轻症到多器官受累。",
    "stages": [
      {
        "stage": "轻型",
        "desc": "上呼吸道症状、无肺炎"
      },
      {
        "stage": "普通型",
        "desc": "肺炎表现、无缺氧"
      },
      {
        "stage": "重型",
        "desc": "呼吸窘迫、血氧下降"
      },
      {
        "stage": "危重型",
        "desc": "呼吸衰竭、需机械通气"
      }
    ]
  },
  {
    "id": "ards",
    "name": "急性呼吸窘迫综合征",
    "category": "respiratory",
    "intro": "各种病因导致的急性弥漫性肺损伤与顽固性低氧。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "轻度低氧"
      },
      {
        "stage": "中度",
        "desc": "中重度低氧、呼吸费力"
      },
      {
        "stage": "重度",
        "desc": "顽固性低氧、常危及生命"
      }
    ]
  },
  {
    "id": "osa",
    "name": "阻塞性睡眠呼吸暂停",
    "category": "respiratory",
    "intro": "睡眠中上气道反复塌陷导致的呼吸暂停与低通气。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "AHI 5-15、轻微打鼾"
      },
      {
        "stage": "中度",
        "desc": "AHI 15-30、白天嗜睡"
      },
      {
        "stage": "重度",
        "desc": "AHI>30、心脑血管风险增"
      }
    ]
  },
  {
    "id": "pulmonary_embolism",
    "name": "肺栓塞",
    "category": "respiratory",
    "intro": "血栓等栓子堵塞肺动脉，可致急性右心衰。",
    "stages": [
      {
        "stage": "低危",
        "desc": "无明显休克、氧合尚可"
      },
      {
        "stage": "中高危",
        "desc": "呼吸困难、右心受累"
      },
      {
        "stage": "高危",
        "desc": "休克、持续低血压，需急救"
      }
    ]
  },
  {
    "id": "bronchiectasis",
    "name": "支气管扩张症",
    "category": "respiratory",
    "intro": "支气管结构破坏伴慢性感染，表现为反复咳痰咯血。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "慢性咳痰、偶有感染"
      },
      {
        "stage": "中度",
        "desc": "反复感染、痰量增多"
      },
      {
        "stage": "重度",
        "desc": "频繁咯血、肺功能损害"
      }
    ]
  },
  {
    "id": "pulmonary_fibrosis",
    "name": "特发性肺纤维化",
    "category": "respiratory",
    "intro": "原因不明的进行性肺间质纤维化，活动耐力下降。",
    "stages": [
      {
        "stage": "GAP I",
        "desc": "轻度受限、活动后气促"
      },
      {
        "stage": "GAP II",
        "desc": "气促加重、咳嗽明显"
      },
      {
        "stage": "GAP III",
        "desc": "静息气促、死亡风险高"
      }
    ]
  },
  {
    "id": "tuberculosis",
    "name": "肺结核",
    "category": "respiratory",
    "intro": "结核分枝杆菌引起的慢性呼吸道传染病，主要侵犯肺部。",
    "stages": [
      {
        "stage": "潜伏感染",
        "desc": "无症状、结核菌素阳性"
      },
      {
        "stage": "活动期",
        "desc": "咳嗽、低热、盗汗"
      },
      {
        "stage": "进展期",
        "desc": "病灶扩大、症状加重"
      },
      {
        "stage": "播散期",
        "desc": "血行播散、累及多器官"
      }
    ]
  },
  {
    "id": "hypertension",
    "name": "高血压",
    "category": "cardiovascular",
    "intro": "血压持续升高，是心脑血管疾病的重要危险因素。",
    "stages": [
      {
        "stage": "1级",
        "desc": "收缩压140-159、多无症状"
      },
      {
        "stage": "2级",
        "desc": "收缩压160-179、可有头晕"
      },
      {
        "stage": "3级",
        "desc": "收缩压≥180、靶器官受损风险"
      },
      {
        "stage": "高血压急症",
        "desc": "血压骤升伴器官损害，医疗急症"
      }
    ]
  },
  {
    "id": "coronary_heart_disease",
    "name": "冠心病",
    "category": "cardiovascular",
    "intro": "冠状动脉粥样硬化致心肌缺血，可表现为心绞痛。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "偶发心绞痛、活动不受限"
      },
      {
        "stage": "中度",
        "desc": "活动耐量下降、需药物管理"
      },
      {
        "stage": "不稳定型",
        "desc": "静息也可发作、随时可进展心梗"
      },
      {
        "stage": "极重",
        "desc": "心源性休克、死亡率极高"
      }
    ]
  },
  {
    "id": "myocardial_infarction",
    "name": "急性心肌梗死",
    "category": "cardiovascular",
    "intro": "冠脉急性闭塞导致心肌坏死，属危重症。",
    "stages": [
      {
        "stage": "Killip I",
        "desc": "无心衰表现"
      },
      {
        "stage": "Killip II",
        "desc": "轻中度心衰、肺底湿啰音"
      },
      {
        "stage": "Killip III",
        "desc": "急性肺水肿"
      },
      {
        "stage": "Killip IV",
        "desc": "心源性休克、死亡风险高"
      }
    ]
  },
  {
    "id": "heart_failure",
    "name": "心力衰竭",
    "category": "cardiovascular",
    "intro": "心脏泵血功能减退，无法满足机体代谢需要。",
    "stages": [
      {
        "stage": "NYHA I",
        "desc": "活动不受限"
      },
      {
        "stage": "NYHA II",
        "desc": "日常活动即气促心悸"
      },
      {
        "stage": "NYHA III",
        "desc": "低于日常活动即症状"
      },
      {
        "stage": "NYHA IV",
        "desc": "静息也有症状"
      }
    ]
  },
  {
    "id": "atrial_fibrillation",
    "name": "心房颤动",
    "category": "cardiovascular",
    "intro": "常见心律失常，心房无序颤动，增加栓塞风险。",
    "stages": [
      {
        "stage": "EHRA I",
        "desc": "无症状"
      },
      {
        "stage": "EHRA II",
        "desc": "轻中度症状、不影响日常"
      },
      {
        "stage": "EHRA III",
        "desc": "明显症状、影响日常"
      },
      {
        "stage": "EHRA IV",
        "desc": "致残性症状、难以活动"
      }
    ]
  },
  {
    "id": "pulmonary_hypertension",
    "name": "肺动脉高压",
    "category": "cardiovascular",
    "intro": "肺动脉压力异常升高，加重右心负担。",
    "stages": [
      {
        "stage": "I级",
        "desc": "日常活动正常"
      },
      {
        "stage": "II级",
        "desc": "日常活动即症状"
      },
      {
        "stage": "III级",
        "desc": "轻微活动即症状"
      },
      {
        "stage": "IV级",
        "desc": "静息仍有症状"
      }
    ]
  },
  {
    "id": "aortic_stenosis",
    "name": "主动脉瓣狭窄",
    "category": "cardiovascular",
    "intro": "主动脉瓣口狭窄，左心排血受阻。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "多无症状"
      },
      {
        "stage": "中度",
        "desc": "活动后气促"
      },
      {
        "stage": "重度",
        "desc": "胸痛、晕厥、猝死风险"
      }
    ]
  },
  {
    "id": "aortic_dissection",
    "name": "主动脉夹层",
    "category": "cardiovascular",
    "intro": "主动脉内膜撕裂、血液进入管壁形成真假腔，凶险急症。",
    "stages": [
      {
        "stage": "A型",
        "desc": "累及升主动脉、需紧急手术"
      },
      {
        "stage": "B型",
        "desc": "仅累及降主动脉、可药物为主"
      },
      {
        "stage": "破裂型",
        "desc": "夹层破裂、极高死亡率"
      }
    ]
  },
  {
    "id": "deep_vein_thrombosis",
    "name": "深静脉血栓",
    "category": "cardiovascular",
    "intro": "深静脉内血栓形成，可致肢体肿胀并脱落致肺栓塞。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "局部肿胀、无栓塞风险"
      },
      {
        "stage": "中度",
        "desc": "明显肿胀疼痛"
      },
      {
        "stage": "重度",
        "desc": "血栓脱落风险高、股青肿"
      }
    ]
  },
  {
    "id": "varicose_veins",
    "name": "下肢静脉曲张",
    "category": "cardiovascular",
    "intro": "下肢静脉瓣膜功能不全致静脉迂曲扩张。",
    "stages": [
      {
        "stage": "早期C1",
        "desc": "毛细血管扩张、网状静脉"
      },
      {
        "stage": "中度",
        "desc": "明显迂曲、酸胀"
      },
      {
        "stage": "重度",
        "desc": "皮肤色素沉着、可溃疡"
      }
    ]
  },
  {
    "id": "shock",
    "name": "低血容量性休克",
    "category": "cardiovascular",
    "intro": "失血或失液导致循环血量不足、器官灌注下降。",
    "stages": [
      {
        "stage": "I级",
        "desc": "失血<15%、脉搏略快"
      },
      {
        "stage": "II级",
        "desc": "心率加快、血压可维持"
      },
      {
        "stage": "III级",
        "desc": "血压下降、尿少"
      },
      {
        "stage": "IV级",
        "desc": "重度休克、意识障碍、濒危"
      }
    ]
  },
  {
    "id": "gastroenteritis",
    "name": "肠胃炎",
    "category": "digestive",
    "intro": "胃肠黏膜急性炎症，多由感染或饮食不洁引起。",
    "stages": [
      {
        "stage": "急性期",
        "desc": "恶心、腹痛、腹泻"
      },
      {
        "stage": "恢复期",
        "desc": "症状缓解、食欲渐复"
      }
    ]
  },
  {
    "id": "diarrhea",
    "name": "腹泻",
    "category": "digestive",
    "intro": "排便次数增多、粪质稀薄，重者可致脱水。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "每日3-5次、稀便"
      },
      {
        "stage": "重度",
        "desc": "水样便、脱水风险"
      }
    ]
  },
  {
    "id": "constipation",
    "name": "便秘",
    "category": "digestive",
    "intro": "排便困难或次数减少，粪质干硬。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "2-3天一次、排便费力"
      },
      {
        "stage": "重度",
        "desc": "多日不解、腹胀腹痛"
      }
    ]
  },
  {
    "id": "gastritis",
    "name": "慢性胃炎",
    "category": "digestive",
    "intro": "胃黏膜慢性炎症，可伴萎缩与肠化。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "黏膜轻度炎症"
      },
      {
        "stage": "中度",
        "desc": "炎症加重、可萎缩"
      },
      {
        "stage": "重度",
        "desc": "广泛萎缩性改变"
      },
      {
        "stage": "癌前病变",
        "desc": "肠上皮化生或异型增生"
      }
    ]
  },
  {
    "id": "peptic_ulcer",
    "name": "消化性溃疡",
    "category": "digestive",
    "intro": "胃或十二指肠黏膜的缺损性病变，可并发出血穿孔。",
    "stages": [
      {
        "stage": "活动期",
        "desc": "上腹隐痛、空腹痛或餐后痛"
      },
      {
        "stage": "愈合期",
        "desc": "溃疡缩小、症状规律"
      },
      {
        "stage": "出血",
        "desc": "呕血或黑便、需止血"
      },
      {
        "stage": "穿孔",
        "desc": "突发剧痛、急腹症"
      }
    ]
  },
  {
    "id": "gerd",
    "name": "胃食管反流病",
    "category": "digestive",
    "intro": "胃内容物反流入食管引起烧心反酸等症状。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "偶发烧心反酸"
      },
      {
        "stage": "中度",
        "desc": "症状频繁、影响生活"
      },
      {
        "stage": "重度",
        "desc": "反流性食管炎、可出血"
      },
      {
        "stage": "极重",
        "desc": "巴雷特食管、癌变风险增"
      }
    ]
  },
  {
    "id": "ulcerative_colitis",
    "name": "溃疡性结肠炎",
    "category": "digestive",
    "intro": "累及结直肠黏膜的慢性炎症性肠病。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "排便<4次/日、无全身症状"
      },
      {
        "stage": "中度",
        "desc": "排便4-6次、轻度全身症状"
      },
      {
        "stage": "重度",
        "desc": "排便>6次、明显全身症状"
      },
      {
        "stage": "暴发型",
        "desc": "中毒性巨结肠风险、危及生命"
      }
    ]
  },
  {
    "id": "crohns",
    "name": "克罗恩病",
    "category": "digestive",
    "intro": "可累及全消化道的透壁性炎症，易并发瘘管狭窄。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "腹痛腹泻、症状轻"
      },
      {
        "stage": "中度",
        "desc": "腹痛腹泻加重、营养不良"
      },
      {
        "stage": "重度",
        "desc": "肠梗阻、瘘管、脓肿"
      }
    ]
  },
  {
    "id": "pancreatitis",
    "name": "胰腺炎",
    "category": "digestive",
    "intro": "胰腺自身消化性炎症，重症可多器官受累。",
    "stages": [
      {
        "stage": "轻症",
        "desc": "腹痛、无器官衰竭"
      },
      {
        "stage": "中重症",
        "desc": "短暂器官衰竭<48小时"
      },
      {
        "stage": "重症",
        "desc": "持续器官衰竭、可坏死感染"
      }
    ]
  },
  {
    "id": "cholecystitis",
    "name": "胆囊炎",
    "category": "digestive",
    "intro": "胆囊的急性或慢性炎症，多与结石相关。",
    "stages": [
      {
        "stage": "东京I级",
        "desc": "局部炎症、右上腹痛"
      },
      {
        "stage": "东京II级",
        "desc": "炎症明显、发热"
      },
      {
        "stage": "东京III级",
        "desc": "全身炎症反应、器官损害"
      }
    ]
  },
  {
    "id": "gallstones",
    "name": "胆石症",
    "category": "digestive",
    "intro": "胆囊或胆管内结石，可致绞痛与胆道并发症。",
    "stages": [
      {
        "stage": "无症状",
        "desc": "体检偶然发现"
      },
      {
        "stage": "症状性",
        "desc": "进食油腻后胆绞痛"
      },
      {
        "stage": "复杂性",
        "desc": "胆囊炎、胆管炎、胰腺炎"
      }
    ]
  },
  {
    "id": "fatty_liver",
    "name": "脂肪肝",
    "category": "hepatobiliary",
    "intro": "肝细胞内脂肪过度蓄积，可进展为肝炎与肝硬化。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "轻度脂肪浸润、多无症状"
      },
      {
        "stage": "中度",
        "desc": "浸润加重、可转氨酶升高"
      },
      {
        "stage": "重度",
        "desc": "广泛脂肪变性、可进展肝炎"
      },
      {
        "stage": "脂肪性肝硬化",
        "desc": "肝纤维化、肝损伤"
      }
    ]
  },
  {
    "id": "cirrhosis",
    "name": "肝硬化",
    "category": "hepatobiliary",
    "intro": "慢性肝损伤致肝纤维化与假小叶形成，肝功能减退。",
    "stages": [
      {
        "stage": "代偿期",
        "desc": "肝功能尚可、症状轻"
      },
      {
        "stage": "失代偿期",
        "desc": "腹水、黄疸、出血、脑病"
      }
    ]
  },
  {
    "id": "hepatic_encephalopathy",
    "name": "肝性脑病",
    "category": "hepatobiliary",
    "intro": "严重肝病引起的神经精神异常，与血氨升高相关。",
    "stages": [
      {
        "stage": "0级",
        "desc": "轻微注意力下降"
      },
      {
        "stage": "I-II级",
        "desc": "嗜睡、行为异常"
      },
      {
        "stage": "III-IV级",
        "desc": "昏睡至昏迷、对疼痛无反应"
      }
    ]
  },
  {
    "id": "hepatitis_b",
    "name": "慢性乙型肝炎",
    "category": "hepatobiliary",
    "intro": "乙肝病毒持续感染，可进展为肝硬化与肝癌。",
    "stages": [
      {
        "stage": "免疫耐受",
        "desc": "病毒高复制、肝功能可正常"
      },
      {
        "stage": "免疫清除",
        "desc": "肝炎活动、转氨酶升高"
      },
      {
        "stage": "低复制",
        "desc": "病毒低水平、病情平稳"
      },
      {
        "stage": "再活动",
        "desc": "病毒复制再增、炎症复发"
      }
    ]
  },
  {
    "id": "hepatitis_c",
    "name": "慢性丙型肝炎",
    "category": "hepatobiliary",
    "intro": "丙肝病毒慢性感染，隐匿进展为肝纤维化。",
    "stages": [
      {
        "stage": "F0-F1",
        "desc": "无或轻度纤维化"
      },
      {
        "stage": "F2",
        "desc": "中度纤维化"
      },
      {
        "stage": "F3",
        "desc": "重度纤维化"
      },
      {
        "stage": "F4",
        "desc": "肝硬化"
      }
    ]
  },
  {
    "id": "liver_failure",
    "name": "肝衰竭",
    "category": "hepatobiliary",
    "intro": "肝细胞大量坏死致肝功能急性丧失，病情凶险。",
    "stages": [
      {
        "stage": "早期",
        "desc": "黄疸加重、凝血异常"
      },
      {
        "stage": "中期",
        "desc": "腹水、出血倾向"
      },
      {
        "stage": "脑水肿期",
        "desc": "肝性脑病、颅内压增高、脑疝"
      }
    ]
  },
  {
    "id": "uti",
    "name": "尿路感染",
    "category": "renal_urinary",
    "intro": "泌尿系统细菌感染，可累及膀胱或肾脏。",
    "stages": [
      {
        "stage": "急性",
        "desc": "尿频、尿急、尿痛"
      },
      {
        "stage": "慢性",
        "desc": "反复发作、腰酸"
      }
    ]
  },
  {
    "id": "chronic_kidney_disease",
    "name": "慢性肾脏病",
    "category": "renal_urinary",
    "intro": "肾脏结构或功能持续异常超过3个月。",
    "stages": [
      {
        "stage": "G1-G2",
        "desc": "肾滤过正常或轻度下降"
      },
      {
        "stage": "G3",
        "desc": "中度下降、可夜尿贫血"
      },
      {
        "stage": "G4",
        "desc": "重度下降、水肿恶心"
      },
      {
        "stage": "G5",
        "desc": "尿毒症、需透析或移植"
      }
    ]
  },
  {
    "id": "acute_kidney_injury",
    "name": "急性肾损伤",
    "category": "renal_urinary",
    "intro": "肾功能短期内急剧下降，可逆但可进展为肾衰。",
    "stages": [
      {
        "stage": "KDIGO 1",
        "desc": "肌酐升高1.5-1.9倍"
      },
      {
        "stage": "KDIGO 2",
        "desc": "肌酐升高2-2.9倍"
      },
      {
        "stage": "KDIGO 3",
        "desc": "肌酐≥3倍或需透析"
      }
    ]
  },
  {
    "id": "bph",
    "name": "良性前列腺增生",
    "category": "urology",
    "intro": "前列腺增生压迫尿道，致排尿困难。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "尿频夜尿、症状轻"
      },
      {
        "stage": "中度",
        "desc": "排尿困难明显"
      },
      {
        "stage": "重度",
        "desc": "尿潴留、肾积水"
      }
    ]
  },
  {
    "id": "nephritis",
    "name": "慢性肾小球肾炎",
    "category": "renal_urinary",
    "intro": "以蛋白尿、血尿、高血压为特征的慢性肾小球疾病。",
    "stages": [
      {
        "stage": "早期",
        "desc": "轻度蛋白尿血尿"
      },
      {
        "stage": "中期",
        "desc": "肾功能开始下降"
      },
      {
        "stage": "晚期",
        "desc": "肾功能明显受损"
      },
      {
        "stage": "终末期",
        "desc": "进展为尿毒症"
      }
    ]
  },
  {
    "id": "diabetes",
    "name": "糖尿病",
    "category": "endocrine_metabolic",
    "intro": "血糖代谢紊乱的慢性病，长期可致多系统并发症。",
    "stages": [
      {
        "stage": "前期",
        "desc": "空腹血糖受损、无典型症状"
      },
      {
        "stage": "早期",
        "desc": "血糖轻度升高、可生活方式控制"
      },
      {
        "stage": "进展期",
        "desc": "三多一少、需药物或胰岛素"
      },
      {
        "stage": "并发症期",
        "desc": "视网膜、肾脏、神经病变"
      }
    ]
  },
  {
    "id": "diabetic_retinopathy",
    "name": "糖尿病视网膜病变",
    "category": "endocrine_metabolic",
    "intro": "糖尿病引起的视网膜微血管病变，可致失明。",
    "stages": [
      {
        "stage": "无病变",
        "desc": "眼底正常"
      },
      {
        "stage": "非增殖期",
        "desc": "微血管瘤、出血渗出"
      },
      {
        "stage": "增殖期",
        "desc": "新生血管、玻璃体出血、失明风险"
      }
    ]
  },
  {
    "id": "diabetic_nephropathy",
    "name": "糖尿病肾病",
    "category": "endocrine_metabolic",
    "intro": "糖尿病引起的肾脏损害，以蛋白尿为标志。",
    "stages": [
      {
        "stage": "早期",
        "desc": "肾小球高滤过、微量白蛋白"
      },
      {
        "stage": "临床期",
        "desc": "持续蛋白尿、肾功能下降"
      },
      {
        "stage": "尿毒症期",
        "desc": "肾衰竭、需透析"
      }
    ]
  },
  {
    "id": "diabetic_foot",
    "name": "糖尿病足",
    "category": "endocrine_metabolic",
    "intro": "糖尿病下肢血管神经病变导致的足部溃疡与感染。",
    "stages": [
      {
        "stage": "Wagner 0",
        "desc": "高危足、无溃疡"
      },
      {
        "stage": "Wagner 1-2",
        "desc": "浅溃疡、深及肌腱"
      },
      {
        "stage": "Wagner 3-4",
        "desc": "深部感染、局部坏疽"
      },
      {
        "stage": "Wagner 5",
        "desc": "全足坏疽"
      }
    ]
  },
  {
    "id": "obesity",
    "name": "肥胖症",
    "category": "endocrine_metabolic",
    "intro": "体内脂肪过度蓄积，增加代谢与心血管疾病风险。",
    "stages": [
      {
        "stage": "I级",
        "desc": "轻度肥胖、并发症风险增"
      },
      {
        "stage": "II级",
        "desc": "中度肥胖、代谢负担加重"
      },
      {
        "stage": "III级",
        "desc": "重度肥胖、多系统损害"
      }
    ]
  },
  {
    "id": "osteoporosis",
    "name": "骨质疏松症",
    "category": "endocrine_metabolic",
    "intro": "骨量减少、骨微结构破坏，易发生脆性骨折。",
    "stages": [
      {
        "stage": "骨量减少",
        "desc": "骨密度略降、无骨折"
      },
      {
        "stage": "骨质疏松",
        "desc": "骨密度显著降低、骨痛"
      },
      {
        "stage": "严重骨质疏松",
        "desc": "伴脆性骨折"
      }
    ]
  },
  {
    "id": "hyperthyroidism",
    "name": "甲状腺功能亢进",
    "category": "endocrine_metabolic",
    "intro": "甲状腺激素分泌过多致高代谢状态。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "心悸手抖、激素轻度升高"
      },
      {
        "stage": "中度",
        "desc": "多汗、体重减轻明显"
      },
      {
        "stage": "重度",
        "desc": "心律失常、消瘦显著"
      },
      {
        "stage": "甲状腺危象",
        "desc": "高热、心衰、危及生命"
      }
    ]
  },
  {
    "id": "hypothyroidism",
    "name": "甲状腺功能减退",
    "category": "endocrine_metabolic",
    "intro": "甲状腺激素分泌不足致低代谢状态。",
    "stages": [
      {
        "stage": "亚临床期",
        "desc": "仅TSH升高、无典型症状"
      },
      {
        "stage": "轻度",
        "desc": "乏力、畏寒、轻微症状"
      },
      {
        "stage": "中重度",
        "desc": "浮肿、反应迟钝明显"
      },
      {
        "stage": "黏液性水肿昏迷",
        "desc": "意识障碍、死亡率高"
      }
    ]
  },
  {
    "id": "cushing",
    "name": "库欣综合征",
    "category": "endocrine_metabolic",
    "intro": "皮质醇长期过多引起的一组临床表现。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "轻度向心性肥胖"
      },
      {
        "stage": "中度",
        "desc": "满月脸、水牛背明显"
      },
      {
        "stage": "重度",
        "desc": "合并高血压、糖尿病"
      },
      {
        "stage": "极重",
        "desc": "严重感染或心血管并发症"
      }
    ]
  },
  {
    "id": "gout",
    "name": "痛风",
    "category": "endocrine_metabolic",
    "intro": "尿酸代谢异常致尿酸盐结晶沉积，引起关节炎。",
    "stages": [
      {
        "stage": "无症状期",
        "desc": "血尿酸升高、无症状"
      },
      {
        "stage": "急性发作期",
        "desc": "关节红肿热痛、剧烈"
      },
      {
        "stage": "间歇期",
        "desc": "发作间期无症状"
      },
      {
        "stage": "慢性期",
        "desc": "痛风石、关节畸形、肾损害"
      }
    ]
  },
  {
    "id": "hypoglycemia",
    "name": "低血糖",
    "category": "endocrine_metabolic",
    "intro": "血糖水平过低，可引起交感兴奋与神经症状。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "头晕、出冷汗、手抖"
      },
      {
        "stage": "重度",
        "desc": "意识模糊、晕厥"
      }
    ]
  },
  {
    "id": "migraine",
    "name": "偏头痛",
    "category": "neurological",
    "intro": "反复发作的中重度搏动性头痛，常伴恶心畏光。",
    "stages": [
      {
        "stage": "先兆期",
        "desc": "视物模糊、畏光"
      },
      {
        "stage": "发作期",
        "desc": "单侧搏动痛、恶心呕吐"
      },
      {
        "stage": "缓解期",
        "desc": "疼痛消退、疲惫"
      }
    ]
  },
  {
    "id": "stroke",
    "name": "急性缺血性脑卒中",
    "category": "neurological",
    "intro": "脑动脉闭塞致脑组织缺血坏死，出现神经功能缺损。",
    "stages": [
      {
        "stage": "轻型",
        "desc": "神经缺损轻微"
      },
      {
        "stage": "中型",
        "desc": "中度缺损、NIHSS5-15"
      },
      {
        "stage": "重型",
        "desc": "重度缺损、意识障碍、偏瘫"
      },
      {
        "stage": "极重",
        "desc": "昏迷、脑疝、预后差"
      }
    ]
  },
  {
    "id": "traumatic_brain_injury",
    "name": "创伤性脑损伤",
    "category": "neurological",
    "intro": "外力所致脑组织损伤，轻重不一。",
    "stages": [
      {
        "stage": "轻型",
        "desc": "短暂意识障碍、可恢复"
      },
      {
        "stage": "中型",
        "desc": "昏迷、可遗留障碍"
      },
      {
        "stage": "重型",
        "desc": "深昏迷、颅内压增高、长期障碍"
      }
    ]
  },
  {
    "id": "parkinson",
    "name": "帕金森病",
    "category": "neurological",
    "intro": "黑质多巴胺神经元退变所致运动障碍。",
    "stages": [
      {
        "stage": "I期",
        "desc": "单侧震颤或迟缓"
      },
      {
        "stage": "II期",
        "desc": "双侧受累、平衡尚可"
      },
      {
        "stage": "III期",
        "desc": "姿势平衡障碍、易摔倒"
      },
      {
        "stage": "IV-V期",
        "desc": "严重残疾、轮椅或卧床"
      }
    ]
  },
  {
    "id": "alzheimer",
    "name": "阿尔茨海默病",
    "category": "neurological",
    "intro": "进行性神经退行性痴呆，以记忆减退起病。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "近记忆减退、生活可自理"
      },
      {
        "stage": "中度",
        "desc": "迷路、语言障碍、需协助"
      },
      {
        "stage": "重度",
        "desc": "丧失自理、大小便失禁"
      },
      {
        "stage": "终末期",
        "desc": "卧床、吞咽反射丧失"
      }
    ]
  },
  {
    "id": "multiple_sclerosis",
    "name": "多发性硬化",
    "category": "neurological",
    "intro": "中枢神经脱髓鞘疾病，症状反复发作与进展。",
    "stages": [
      {
        "stage": "复发缓解型",
        "desc": "发作后部分恢复"
      },
      {
        "stage": "继发进展型",
        "desc": "持续进展"
      },
      {
        "stage": "原发进展型",
        "desc": "起病即持续加重"
      },
      {
        "stage": "重度进展期",
        "desc": "严重残疾、轮椅或卧床"
      }
    ]
  },
  {
    "id": "myasthenia_gravis",
    "name": "重症肌无力",
    "category": "neurological",
    "intro": "神经肌肉接头传递障碍，骨骼肌易疲劳无力。",
    "stages": [
      {
        "stage": "MGFA I",
        "desc": "单纯眼肌无力"
      },
      {
        "stage": "MGFA II-III",
        "desc": "肢体无力、影响日常"
      },
      {
        "stage": "MGFA IV-V",
        "desc": "吞咽呼吸肌受累、危象"
      }
    ]
  },
  {
    "id": "als",
    "name": "肌萎缩侧索硬化症",
    "category": "neurological",
    "intro": "进行性运动神经元退变，渐至全身瘫痪（渐冻症）。",
    "stages": [
      {
        "stage": "早期",
        "desc": "肢体无力、肌萎缩"
      },
      {
        "stage": "进展期",
        "desc": "吞咽言语受累"
      },
      {
        "stage": "末期",
        "desc": "呼吸肌麻痹、需呼吸机"
      }
    ]
  },
  {
    "id": "bells_palsy",
    "name": "贝尔面瘫",
    "category": "neurological",
    "intro": "特发性面神经麻痹，致单侧面部表情肌无力。",
    "stages": [
      {
        "stage": "I-III级",
        "desc": "轻度面瘫、可恢复"
      },
      {
        "stage": "IV-V级",
        "desc": "中重度面瘫、恢复慢"
      },
      {
        "stage": "VI级",
        "desc": "完全性面瘫"
      }
    ]
  },
  {
    "id": "epilepsy",
    "name": "癫痫",
    "category": "neurological",
    "intro": "脑神经元异常放电所致的反复发作性疾病。",
    "stages": [
      {
        "stage": "新发",
        "desc": "首次发作、需评估"
      },
      {
        "stage": "药物反应性",
        "desc": "药物控制良好"
      },
      {
        "stage": "药物难治性",
        "desc": "规范用药仍反复发作"
      },
      {
        "stage": "持续状态",
        "desc": "发作持续、危及生命"
      }
    ]
  },
  {
    "id": "spinal_cord_injury",
    "name": "脊髓损伤",
    "category": "neurological",
    "intro": "脊髓受压或离断致感觉运动障碍。",
    "stages": [
      {
        "stage": "ASIA A",
        "desc": "完全性损伤"
      },
      {
        "stage": "ASIA B-C",
        "desc": "感觉/运动部分保留"
      },
      {
        "stage": "ASIA D-E",
        "desc": "接近正常神经功能"
      }
    ]
  },
  {
    "id": "insomnia",
    "name": "失眠",
    "category": "psychiatric",
    "intro": "入睡或维持睡眠困难，影响日间功能。",
    "stages": [
      {
        "stage": "入睡困难",
        "desc": "躺下久久无法入睡"
      },
      {
        "stage": "早醒多梦",
        "desc": "易醒、多梦、醒后难眠"
      },
      {
        "stage": "彻夜难眠",
        "desc": "整夜几乎无眠"
      }
    ]
  },
  {
    "id": "depression",
    "name": "抑郁障碍",
    "category": "psychiatric",
    "intro": "以持续心境低落、兴趣减退为核心的心境障碍。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "情绪低落、可勉强维持"
      },
      {
        "stage": "中度",
        "desc": "兴趣丧失、社会功能受损"
      },
      {
        "stage": "重度",
        "desc": "绝望、自伤风险、功能严重受损"
      },
      {
        "stage": "伴精神病性",
        "desc": "伴幻觉妄想、风险高"
      }
    ]
  },
  {
    "id": "bipolar",
    "name": "双相情感障碍",
    "category": "psychiatric",
    "intro": "躁狂与抑郁交替或混合发作的心境障碍。",
    "stages": [
      {
        "stage": "轻躁狂",
        "desc": "情绪高涨、尚可控"
      },
      {
        "stage": "躁狂",
        "desc": "极度高涨、行为紊乱"
      },
      {
        "stage": "抑郁",
        "desc": "情绪低落、兴趣丧失"
      },
      {
        "stage": "混合发作",
        "desc": "躁狂抑郁交替或并存"
      }
    ]
  },
  {
    "id": "anxiety",
    "name": "焦虑障碍",
    "category": "psychiatric",
    "intro": "过度担忧与紧张，伴躯体症状与回避行为。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "轻微担忧、不影响生活"
      },
      {
        "stage": "中度",
        "desc": "明显焦虑、影响功能"
      },
      {
        "stage": "重度",
        "desc": "严重焦虑、社会功能受限"
      },
      {
        "stage": "惊恐发作",
        "desc": "急性濒死感、需紧急干预"
      }
    ]
  },
  {
    "id": "ocd",
    "name": "强迫症",
    "category": "psychiatric",
    "intro": "反复出现的强迫观念与强迫行为，难以自控。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "偶有强迫、不影响日常"
      },
      {
        "stage": "中度",
        "desc": "每日占用数小时、明显焦虑"
      },
      {
        "stage": "重度",
        "desc": "被强迫完全控制、功能丧失"
      }
    ]
  },
  {
    "id": "schizophrenia",
    "name": "精神分裂症",
    "category": "psychiatric",
    "intro": "以思维、情感、行为分裂为特征的重性精神障碍。",
    "stages": [
      {
        "stage": "前驱期",
        "desc": "社会退缩等早期征象"
      },
      {
        "stage": "急性期",
        "desc": "幻觉妄想等阳性症状"
      },
      {
        "stage": "恢复期",
        "desc": "症状部分缓解"
      },
      {
        "stage": "残留期",
        "desc": "慢性化、阴性症状为主"
      }
    ]
  },
  {
    "id": "osteoarthritis",
    "name": "骨关节炎",
    "category": "musculoskeletal",
    "intro": "关节软骨退变与骨质增生，常见于负重关节。",
    "stages": [
      {
        "stage": "0级",
        "desc": "无异常"
      },
      {
        "stage": "I级",
        "desc": "可疑骨赘"
      },
      {
        "stage": "II级",
        "desc": "明确骨赘、间隙轻度窄"
      },
      {
        "stage": "III级",
        "desc": "间隙明显狭窄、骨赘多"
      },
      {
        "stage": "IV级",
        "desc": "间隙消失、明显畸形"
      }
    ]
  },
  {
    "id": "scoliosis",
    "name": "脊柱侧弯",
    "category": "musculoskeletal",
    "intro": "脊柱向侧方弯曲，常按Cobb角分级。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "侧弯不明显、多无症状"
      },
      {
        "stage": "中度",
        "desc": "外观改变、可疼痛"
      },
      {
        "stage": "重度",
        "desc": "明显畸形、可影响心肺"
      }
    ]
  },
  {
    "id": "cervical_spondylosis",
    "name": "颈椎病",
    "category": "musculoskeletal",
    "intro": "颈椎退变压迫神经或脊髓，引起颈肩痛或神经症状。",
    "stages": [
      {
        "stage": "局部型",
        "desc": "颈肩酸痛、僵硬"
      },
      {
        "stage": "神经根型",
        "desc": "放射痛、手指麻木"
      },
      {
        "stage": "脊髓型",
        "desc": "下肢无力、踩棉花感、可瘫痪"
      }
    ]
  },
  {
    "id": "spondylolisthesis",
    "name": "脊椎滑脱",
    "category": "musculoskeletal",
    "intro": "上位椎体相对下位椎体滑移，可压迫神经。",
    "stages": [
      {
        "stage": "Meyerding I-II",
        "desc": "轻度滑移、可腰痛"
      },
      {
        "stage": "Meyerding III-IV",
        "desc": "明显滑移、神经压迫"
      },
      {
        "stage": "Meyerding V",
        "desc": "完全滑脱、脊柱不稳"
      }
    ]
  },
  {
    "id": "ankylosing_spondylitis",
    "name": "强直性脊柱炎",
    "category": "musculoskeletal",
    "intro": "以骶髂关节和脊柱附着点炎症为主的慢性病。",
    "stages": [
      {
        "stage": "早期",
        "desc": "腰背晨僵、无明显畸形"
      },
      {
        "stage": "中期",
        "desc": "脊柱活动受限增加"
      },
      {
        "stage": "重度",
        "desc": "脊柱竹节样变、强直驼背"
      }
    ]
  },
  {
    "id": "rheumatoid_arthritis",
    "name": "类风湿关节炎",
    "category": "rheumatic_immune",
    "intro": "对称性多关节慢性滑膜炎症，可致关节破坏畸形。",
    "stages": [
      {
        "stage": "早期",
        "desc": "关节晨僵、无骨质破坏"
      },
      {
        "stage": "进展期",
        "desc": "关节肿痛、出现骨侵蚀"
      },
      {
        "stage": "重度",
        "desc": "关节畸形、功能受限"
      },
      {
        "stage": "终末期",
        "desc": "关节强直、严重残疾"
      }
    ]
  },
  {
    "id": "sle",
    "name": "系统性红斑狼疮",
    "category": "rheumatic_immune",
    "intro": "多系统受累的自身免疫病，好发于育龄女性。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "皮肤关节受累为主"
      },
      {
        "stage": "中度",
        "desc": "浆膜炎等系统受累"
      },
      {
        "stage": "重度",
        "desc": "肾脏、中枢神经、血液受累"
      },
      {
        "stage": "狼疮危象",
        "desc": "多器官衰竭"
      }
    ]
  },
  {
    "id": "sjogren",
    "name": "干燥综合征",
    "category": "rheumatic_immune",
    "intro": "以外分泌腺体受累为主的自身免疫病，口眼干燥。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "口眼干燥为主"
      },
      {
        "stage": "中度",
        "desc": "合并腺体外表现"
      },
      {
        "stage": "重度",
        "desc": "内脏器官受累"
      },
      {
        "stage": "极重",
        "desc": "合并淋巴瘤等恶性病变"
      }
    ]
  },
  {
    "id": "scleroderma",
    "name": "系统性硬化症",
    "category": "rheumatic_immune",
    "intro": "皮肤与内脏纤维化的自身免疫病。",
    "stages": [
      {
        "stage": "局限型",
        "desc": "皮肤增厚限于四肢远端"
      },
      {
        "stage": "弥漫型",
        "desc": "广泛皮肤增厚"
      },
      {
        "stage": "内脏受累期",
        "desc": "肺、肾、心脏受累"
      },
      {
        "stage": "终末期",
        "desc": "多器官功能衰竭"
      }
    ]
  },
  {
    "id": "allergy",
    "name": "过敏",
    "category": "rheumatic_immune",
    "intro": "机体对无害抗原的异常免疫应答，可累及多系统。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "皮肤发痒、打喷嚏"
      },
      {
        "stage": "重度",
        "desc": "皮疹、呼吸困难"
      },
      {
        "stage": "过敏性休克",
        "desc": "血压骤降、意识丧失、危及生命"
      }
    ]
  },
  {
    "id": "psoriasis",
    "name": "银屑病",
    "category": "dermatological",
    "intro": "慢性鳞屑性皮肤病，与免疫和遗传相关。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "皮损<体表3%"
      },
      {
        "stage": "中度",
        "desc": "皮损3-10%、鳞屑明显"
      },
      {
        "stage": "重度",
        "desc": "皮损>10%、影响生活"
      },
      {
        "stage": "红皮病型",
        "desc": "全身皮肤受累"
      }
    ]
  },
  {
    "id": "eczema",
    "name": "特应性皮炎",
    "category": "dermatological",
    "intro": "慢性复发性瘙痒性皮肤病，皮肤屏障功能受损。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "局部瘙痒、皮损轻"
      },
      {
        "stage": "中度",
        "desc": "皮损扩大、瘙痒明显"
      },
      {
        "stage": "重度",
        "desc": "广泛皮损、渗出结痂"
      },
      {
        "stage": "极重",
        "desc": "全身泛发、继发感染"
      }
    ]
  },
  {
    "id": "hidradenitis",
    "name": "化脓性汗腺炎",
    "category": "dermatological",
    "intro": "毛囊皮脂腺单位的慢性炎症，形成脓肿瘘管。",
    "stages": [
      {
        "stage": "Hurley I",
        "desc": "孤立脓肿"
      },
      {
        "stage": "Hurley II",
        "desc": "反复发作、窦道形成"
      },
      {
        "stage": "Hurley III",
        "desc": "大片受累、广泛瘘管瘢痕"
      }
    ]
  },
  {
    "id": "acne",
    "name": "痤疮",
    "category": "dermatological",
    "intro": "毛囊皮脂腺慢性炎症，好发于面部。",
    "stages": [
      {
        "stage": "I级",
        "desc": "粉刺为主"
      },
      {
        "stage": "II-III级",
        "desc": "炎性丘疹、脓疱"
      },
      {
        "stage": "IV级",
        "desc": "结节囊肿、易留瘢痕"
      }
    ]
  },
  {
    "id": "pressure_injury",
    "name": "压力性损伤",
    "category": "dermatological",
    "intro": "长期受压致皮肤与皮下组织缺血坏死（压疮）。",
    "stages": [
      {
        "stage": "1期",
        "desc": "皮肤发红、不褪色"
      },
      {
        "stage": "2期",
        "desc": "表皮破损、水疱"
      },
      {
        "stage": "3期",
        "desc": "全层皮肤缺损"
      },
      {
        "stage": "4期",
        "desc": "深达肌肉骨骼"
      }
    ]
  },
  {
    "id": "burn",
    "name": "烧伤",
    "category": "dermatological",
    "intro": "热力等致皮肤组织损伤，按深度与面积分级。",
    "stages": [
      {
        "stage": "I度",
        "desc": "仅表皮、红斑"
      },
      {
        "stage": "浅II度",
        "desc": "真皮浅层、水疱"
      },
      {
        "stage": "深II度",
        "desc": "真皮深层、愈合慢"
      },
      {
        "stage": "III度",
        "desc": "全层坏死、需植皮"
      }
    ]
  },
  {
    "id": "pemphigus",
    "name": "天疱疮",
    "category": "dermatological",
    "intro": "自身免疫性大疱性疾病，皮肤黏膜起水疱剥脱。",
    "stages": [
      {
        "stage": "局限型",
        "desc": "局部水疱"
      },
      {
        "stage": "泛发型",
        "desc": "大面积水疱剥脱、如烧伤"
      },
      {
        "stage": "极重",
        "desc": "全身泛发、感染或体液丢失致死"
      }
    ]
  },
  {
    "id": "conjunctivitis",
    "name": "结膜炎",
    "category": "ophthalmology",
    "intro": "结膜炎症，表现为眼红、眼痒、分泌物增多。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "眼红眼痒、少量分泌物"
      },
      {
        "stage": "重度",
        "desc": "分泌物多、睑结膜充血明显"
      }
    ]
  },
  {
    "id": "glaucoma",
    "name": "青光眼",
    "category": "ophthalmology",
    "intro": "眼压升高致视神经损伤，视野进行性缺损。",
    "stages": [
      {
        "stage": "早期",
        "desc": "视野轻度缺损、常无症状"
      },
      {
        "stage": "中期",
        "desc": "视野缺损加重"
      },
      {
        "stage": "晚期",
        "desc": "视野严重缺损"
      },
      {
        "stage": "终末期",
        "desc": "仅存光感或失明"
      }
    ]
  },
  {
    "id": "cataract",
    "name": "白内障",
    "category": "ophthalmology",
    "intro": "晶状体混浊，视力逐渐下降。",
    "stages": [
      {
        "stage": "初发期",
        "desc": "轻度混浊、视力略降"
      },
      {
        "stage": "未熟期",
        "desc": "混浊加重、视力明显下降"
      },
      {
        "stage": "成熟期",
        "desc": "完全混浊、仅存光感"
      },
      {
        "stage": "过熟期",
        "desc": "晶状体液化、并发症风险"
      }
    ]
  },
  {
    "id": "amd",
    "name": "年龄相关性黄斑变性",
    "category": "ophthalmology",
    "intro": "黄斑区退行性病变，损害中心视力。",
    "stages": [
      {
        "stage": "早期",
        "desc": "黄斑结构改变、视力尚可"
      },
      {
        "stage": "中期",
        "desc": "中心视力开始下降"
      },
      {
        "stage": "晚期干性",
        "desc": "地图状萎缩、视力严重受损"
      },
      {
        "stage": "晚期湿性",
        "desc": "新生血管、快速损害中心视力"
      }
    ]
  },
  {
    "id": "keratoconus",
    "name": "圆锥角膜",
    "category": "ophthalmology",
    "intro": "角膜进行性变薄前突，致不规则散光。",
    "stages": [
      {
        "stage": "I-II期",
        "desc": "轻度变薄、不规则散光"
      },
      {
        "stage": "III期",
        "desc": "明显前突、视力下降"
      },
      {
        "stage": "IV期",
        "desc": "严重变薄、可能需角膜移植"
      }
    ]
  },
  {
    "id": "hearing_loss",
    "name": "听力损失",
    "category": "ent",
    "intro": "听觉功能下降，可为突发性或渐进性。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "听力损失26-40dB"
      },
      {
        "stage": "中度",
        "desc": "损失41-60dB"
      },
      {
        "stage": "重度",
        "desc": "损失61-80dB"
      },
      {
        "stage": "极重度",
        "desc": ">80dB、接近全聋"
      }
    ]
  },
  {
    "id": "periodontitis",
    "name": "牙周炎",
    "category": "ent",
    "intro": "牙周支持组织慢性炎症，可致牙齿松动脱落。",
    "stages": [
      {
        "stage": "I-II期",
        "desc": "牙龈退缩、附着丧失轻"
      },
      {
        "stage": "III期",
        "desc": "牙槽骨中度吸收、牙齿松动"
      },
      {
        "stage": "IV期",
        "desc": "严重骨吸收、牙齿脱落"
      }
    ]
  },
  {
    "id": "gingivitis",
    "name": "牙龈炎",
    "category": "ent",
    "intro": "牙龈炎症，表现为红肿出血，尚无骨吸收。",
    "stages": [
      {
        "stage": "早期",
        "desc": "刷牙偶有出血"
      },
      {
        "stage": "明显期",
        "desc": "牙龈红肿、易出血"
      }
    ]
  },
  {
    "id": "vestibular_neuritis",
    "name": "前庭神经炎",
    "category": "ent",
    "intro": "前庭神经病毒感染致急性眩晕。",
    "stages": [
      {
        "stage": "急性期",
        "desc": "剧烈眩晕、持续数天"
      },
      {
        "stage": "亚急性期",
        "desc": "症状逐渐减轻"
      },
      {
        "stage": "恢复期",
        "desc": "轻微不稳感"
      },
      {
        "stage": "慢性期",
        "desc": "偶发头晕"
      }
    ]
  },
  {
    "id": "hiv",
    "name": "艾滋病（HIV感染）",
    "category": "infectious",
    "intro": "HIV病毒破坏免疫系统，晚期致机会性感染与肿瘤。",
    "stages": [
      {
        "stage": "急性期",
        "desc": "类流感症状、可无"
      },
      {
        "stage": "无症状期",
        "desc": "病毒潜伏、免疫渐降"
      },
      {
        "stage": "艾滋病期",
        "desc": "CD4极度低下、机会性感染肿瘤"
      }
    ]
  },
  {
    "id": "syphilis",
    "name": "梅毒",
    "category": "infectious",
    "intro": "梅毒螺旋体感染，分阶段累及多器官。",
    "stages": [
      {
        "stage": "一期",
        "desc": "无痛性硬下疳"
      },
      {
        "stage": "二期",
        "desc": "皮疹、全身症状"
      },
      {
        "stage": "潜伏期",
        "desc": "无症状、血清阳性"
      },
      {
        "stage": "三期",
        "desc": "心血管、神经损害"
      }
    ]
  },
  {
    "id": "dengue",
    "name": "登革热",
    "category": "infectious",
    "intro": "登革病毒经蚊媒传播，重症可致休克出血。",
    "stages": [
      {
        "stage": "无警示征",
        "desc": "发热、皮疹、肌肉痛"
      },
      {
        "stage": "伴警示征",
        "desc": "腹痛、出血倾向"
      },
      {
        "stage": "重症",
        "desc": "休克、严重出血、器官衰竭"
      }
    ]
  },
  {
    "id": "malaria",
    "name": "疟疾",
    "category": "infectious",
    "intro": "疟原虫经蚊媒传播的寄生虫病，周期性寒热发作。",
    "stages": [
      {
        "stage": "非重症",
        "desc": "周期性寒战高热"
      },
      {
        "stage": "重症",
        "desc": "昏迷、严重贫血、器官损伤"
      }
    ]
  },
  {
    "id": "hand_foot_mouth",
    "name": "手足口病",
    "category": "infectious",
    "intro": "肠道病毒引起的儿童传染病，手足口皮疹。",
    "stages": [
      {
        "stage": "普通型",
        "desc": "发热、手足口疱疹"
      },
      {
        "stage": "重型",
        "desc": "高热、神经系统受累"
      },
      {
        "stage": "危重型",
        "desc": "肺水肿、循环衰竭"
      }
    ]
  },
  {
    "id": "pertussis",
    "name": "百日咳",
    "category": "infectious",
    "intro": "百日咳杆菌引起的阵发性痉咳。",
    "stages": [
      {
        "stage": "卡他期",
        "desc": "类感冒症状、传染性强"
      },
      {
        "stage": "痉咳期",
        "desc": "阵发性痉咳、剧烈"
      },
      {
        "stage": "恢复期",
        "desc": "咳嗽逐渐减轻"
      }
    ]
  },
  {
    "id": "sepsis",
    "name": "脓毒症",
    "category": "infectious",
    "intro": "感染引起的全身炎症反应与器官功能障碍。",
    "stages": [
      {
        "stage": "全身炎症反应期",
        "desc": "符合SIRS标准"
      },
      {
        "stage": "脓毒症期",
        "desc": "感染伴器官功能障碍"
      },
      {
        "stage": "严重脓毒症",
        "desc": "组织低灌注"
      },
      {
        "stage": "脓毒性休克",
        "desc": "持续低血压、死亡率高"
      }
    ]
  },
  {
    "id": "tetanus",
    "name": "破伤风",
    "category": "infectious",
    "intro": "破伤风杆菌毒素致肌肉强直痉挛。",
    "stages": [
      {
        "stage": "前驱期",
        "desc": "张口困难、肌紧张"
      },
      {
        "stage": "痉挛期",
        "desc": "全身强直、阵发痉挛"
      },
      {
        "stage": "极重度",
        "desc": "窒息或呼吸衰竭致死"
      }
    ]
  },
  {
    "id": "cholera",
    "name": "霍乱",
    "category": "infectious",
    "intro": "霍乱弧菌引起的烈性肠道传染病，剧烈水样泻。",
    "stages": [
      {
        "stage": "轻症",
        "desc": "轻度腹泻"
      },
      {
        "stage": "重症",
        "desc": "米泔水样泻、频繁呕吐"
      },
      {
        "stage": "极重脱水",
        "desc": "重度脱水、低血容量休克"
      }
    ]
  },
  {
    "id": "rabies",
    "name": "狂犬病",
    "category": "infectious",
    "intro": "狂犬病毒经动物咬伤传播，发病后几乎致死。",
    "stages": [
      {
        "stage": "前驱期",
        "desc": "伤口不适、乏力"
      },
      {
        "stage": "兴奋期",
        "desc": "恐水、怕风、痉挛"
      },
      {
        "stage": "麻痹期",
        "desc": "进行性瘫痪、死亡"
      }
    ]
  },
  {
    "id": "gastric_cancer",
    "name": "胃癌",
    "category": "oncology",
    "intro": "胃黏膜上皮的恶性肿瘤，早期多无症状。",
    "stages": [
      {
        "stage": "早期",
        "desc": "局限于黏膜、可根治"
      },
      {
        "stage": "进展期",
        "desc": "浸润加深、淋巴结转移"
      },
      {
        "stage": "晚期",
        "desc": "远处转移"
      }
    ]
  },
  {
    "id": "colorectal_cancer",
    "name": "结直肠癌",
    "category": "oncology",
    "intro": "结直肠黏膜的恶性肿瘤，与息肉和遗传相关。",
    "stages": [
      {
        "stage": "I期",
        "desc": "局限于肠壁"
      },
      {
        "stage": "II期",
        "desc": "穿透肠壁、未及淋巴结"
      },
      {
        "stage": "III期",
        "desc": "区域淋巴结转移"
      },
      {
        "stage": "IV期",
        "desc": "远处转移"
      }
    ]
  },
  {
    "id": "breast_cancer",
    "name": "乳腺癌",
    "category": "oncology",
    "intro": "乳腺上皮的恶性肿瘤，女性常见。",
    "stages": [
      {
        "stage": "I期",
        "desc": "肿瘤≤2cm、无转移"
      },
      {
        "stage": "II期",
        "desc": "肿瘤增大或腋窝淋巴结转移"
      },
      {
        "stage": "III期",
        "desc": "局部晚期、广泛淋巴结转移"
      },
      {
        "stage": "IV期",
        "desc": "远处转移"
      }
    ]
  },
  {
    "id": "lung_cancer",
    "name": "肺癌",
    "category": "oncology",
    "intro": "肺部的恶性肿瘤，非小细胞与小细胞两大类。",
    "stages": [
      {
        "stage": "I期",
        "desc": "肿瘤局限、未侵淋巴结"
      },
      {
        "stage": "II期",
        "desc": "局部淋巴结受累"
      },
      {
        "stage": "III期",
        "desc": "区域淋巴结广泛转移"
      },
      {
        "stage": "IV期",
        "desc": "远处转移"
      }
    ]
  },
  {
    "id": "cervical_cancer",
    "name": "宫颈癌",
    "category": "oncology",
    "intro": "宫颈的恶性肿瘤，与HPV持续感染相关。",
    "stages": [
      {
        "stage": "I期",
        "desc": "局限于宫颈"
      },
      {
        "stage": "II期",
        "desc": "超出子宫未达盆壁"
      },
      {
        "stage": "III期",
        "desc": "达盆壁或阴道下1/3"
      },
      {
        "stage": "IV期",
        "desc": "侵犯膀胱直肠或远处转移"
      }
    ]
  },
  {
    "id": "prostate_cancer",
    "name": "前列腺癌",
    "category": "oncology",
    "intro": "前列腺的恶性肿瘤，与PSA和Gleason评分相关。",
    "stages": [
      {
        "stage": "局限性",
        "desc": "肿瘤限于前列腺内"
      },
      {
        "stage": "局部进展",
        "desc": "突破包膜、侵犯周围"
      },
      {
        "stage": "转移性",
        "desc": "远处转移"
      }
    ]
  },
  {
    "id": "liver_cancer",
    "name": "肝细胞癌",
    "category": "oncology",
    "intro": "原发性肝癌，多发生于肝硬化基础之上。",
    "stages": [
      {
        "stage": "极早期",
        "desc": "单发小肿瘤"
      },
      {
        "stage": "早期",
        "desc": "单发、无血管侵犯"
      },
      {
        "stage": "中期",
        "desc": "多发或血管侵犯"
      },
      {
        "stage": "晚期",
        "desc": "门静脉受累或远处转移"
      },
      {
        "stage": "终末期",
        "desc": "肝功能衰竭"
      }
    ]
  },
  {
    "id": "ovarian_cancer",
    "name": "卵巢癌",
    "category": "oncology",
    "intro": "卵巢的恶性肿瘤，起病隐匿、发现常偏晚。",
    "stages": [
      {
        "stage": "I期",
        "desc": "局限于卵巢"
      },
      {
        "stage": "II期",
        "desc": "盆腔内扩散"
      },
      {
        "stage": "III期",
        "desc": "腹腔种植或淋巴结转移"
      },
      {
        "stage": "IV期",
        "desc": "远处转移"
      }
    ]
  },
  {
    "id": "melanoma",
    "name": "恶性黑色素瘤",
    "category": "oncology",
    "intro": "黑色素细胞来源的高度恶性肿瘤，进展迅速。",
    "stages": [
      {
        "stage": "早期",
        "desc": "原位或浅表、可切除"
      },
      {
        "stage": "局部进展",
        "desc": "浸润加深、可淋巴结转移"
      },
      {
        "stage": "IV期",
        "desc": "广泛远处转移、预后差"
      }
    ]
  },
  {
    "id": "anemia",
    "name": "贫血",
    "category": "hematologic",
    "intro": "血红蛋白低于正常，引起组织供氧不足。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "Hb 90-120g/L、症状轻"
      },
      {
        "stage": "中度",
        "desc": "Hb 60-90g/L、乏力头晕"
      },
      {
        "stage": "重度",
        "desc": "Hb 30-60g/L、明显缺血"
      },
      {
        "stage": "极重",
        "desc": "Hb<30g/L、危及生命"
      }
    ]
  },
  {
    "id": "leukemia",
    "name": "白血病",
    "category": "hematologic",
    "intro": "造血系统的恶性肿瘤，异常白细胞大量增生。",
    "stages": [
      {
        "stage": "慢性期",
        "desc": "症状轻、血象轻度异常"
      },
      {
        "stage": "加速期",
        "desc": "症状加重、耐药"
      },
      {
        "stage": "急变期",
        "desc": "转化为急性白血病"
      },
      {
        "stage": "终末期",
        "desc": "多器官衰竭"
      }
    ]
  },
  {
    "id": "thrombocytopenia",
    "name": "血小板减少症",
    "category": "hematologic",
    "intro": "血小板计数降低，出血风险增加。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "血小板50-100、出血风险低"
      },
      {
        "stage": "中度",
        "desc": "30-50、易瘀斑"
      },
      {
        "stage": "重度",
        "desc": "10-30、明显出血"
      },
      {
        "stage": "极重",
        "desc": "<10、自发出血风险高"
      }
    ]
  },
  {
    "id": "aplastic_anemia",
    "name": "再生障碍性贫血",
    "category": "hematologic",
    "intro": "骨髓造血功能衰竭，全血细胞减少。",
    "stages": [
      {
        "stage": "轻型",
        "desc": "血细胞轻度减少"
      },
      {
        "stage": "重型",
        "desc": "全血细胞严重减少、感染出血"
      }
    ]
  },
  {
    "id": "multiple_myeloma",
    "name": "多发性骨髓瘤",
    "category": "hematologic",
    "intro": "浆细胞恶性增殖，致骨破坏与肾功能损害。",
    "stages": [
      {
        "stage": "I期",
        "desc": "肿瘤负荷低"
      },
      {
        "stage": "II期",
        "desc": "中度负荷"
      },
      {
        "stage": "III期",
        "desc": "骨痛、贫血、肾损伤、高钙"
      }
    ]
  },
  {
    "id": "mds",
    "name": "骨髓增生异常综合征",
    "category": "hematologic",
    "intro": "骨髓病态造血，可进展为急性白血病。",
    "stages": [
      {
        "stage": "低危",
        "desc": "血细胞减少轻、进展慢"
      },
      {
        "stage": "高危",
        "desc": "血细胞明显减少、向白血病转化"
      }
    ]
  },
  {
    "id": "dysmenorrhea",
    "name": "痛经",
    "category": "gynecological",
    "intro": "经期或经前后的下腹疼痛，可伴恶心冷汗。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "下腹坠胀、隐痛"
      },
      {
        "stage": "重度",
        "desc": "绞痛、冷汗、需卧床"
      }
    ]
  },
  {
    "id": "endometriosis",
    "name": "子宫内膜异位症",
    "category": "gynecological",
    "intro": "子宫内膜组织异位生长，致痛经与不孕。",
    "stages": [
      {
        "stage": "I期（微小）",
        "desc": "少量表浅病灶"
      },
      {
        "stage": "II期（轻度）",
        "desc": "病灶增多变深、可粘连"
      },
      {
        "stage": "III期（中度）",
        "desc": "巧克力囊肿、盆腔粘连"
      },
      {
        "stage": "IV期（重度）",
        "desc": "广泛致密粘连、累及肠泌尿"
      }
    ]
  },
  {
    "id": "preeclampsia",
    "name": "子痫前期",
    "category": "gynecological",
    "intro": "妊娠期高血压伴蛋白尿，可进展为子痫。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "血压轻度升高、蛋白尿轻微"
      },
      {
        "stage": "重度",
        "desc": "血压显著升高、多器官受累"
      },
      {
        "stage": "子痫",
        "desc": "抽搐发作、危及母儿"
      }
    ]
  },
  {
    "id": "pelvic_inflammatory_disease",
    "name": "盆腔炎",
    "category": "gynecological",
    "intro": "女性上生殖道感染，可致慢性盆腔痛与不孕。",
    "stages": [
      {
        "stage": "急性期",
        "desc": "下腹痛、发热、分泌物增多"
      },
      {
        "stage": "慢性期",
        "desc": "反复下腹隐痛、性交痛"
      }
    ]
  },
  {
    "id": "prostatitis",
    "name": "前列腺炎",
    "category": "urology",
    "intro": "前列腺的炎症，分急性细菌性与慢性，常见尿频尿痛与会阴不适。",
    "stages": [
      {
        "stage": "急性",
        "desc": "发热、尿痛、会阴胀痛"
      },
      {
        "stage": "慢性",
        "desc": "反复尿频、骨盆区隐痛"
      }
    ]
  },
  {
    "id": "epididymitis",
    "name": "附睾炎",
    "category": "urology",
    "intro": "附睾的感染性炎症，多为细菌逆行感染，阴囊红肿疼痛。",
    "stages": [
      {
        "stage": "急性期",
        "desc": "阴囊红肿热痛、可发热"
      },
      {
        "stage": "恢复期",
        "desc": "肿痛渐退、可留硬结"
      }
    ]
  },
  {
    "id": "varicocele",
    "name": "精索静脉曲张",
    "category": "urology",
    "intro": "精索静脉回流受阻致迂曲扩张，可致阴囊坠胀与生育力下降。",
    "stages": [
      {
        "stage": "I 度",
        "desc": "仅屏气时触及"
      },
      {
        "stage": "II 度",
        "desc": "站立可触及、平卧消失"
      },
      {
        "stage": "III 度",
        "desc": "肉眼可见蚯蚓团、持续坠胀"
      }
    ]
  },
  {
    "id": "balanitis",
    "name": "包皮龟头炎",
    "category": "urology",
    "intro": "包皮与龟头的炎症，多见卫生不佳、包皮过长或感染。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "局部红斑、轻痒"
      },
      {
        "stage": "重度",
        "desc": "糜烂渗液、疼痛明显"
      }
    ]
  },
  {
    "id": "neonatal_jaundice",
    "name": "新生儿黄疸",
    "category": "pediatric",
    "intro": "新生儿胆红素升高致皮肤黄染，多为生理性。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "胆红素略高、多生理性"
      },
      {
        "stage": "中度",
        "desc": "需光疗干预"
      },
      {
        "stage": "重度",
        "desc": "接近换血标准"
      },
      {
        "stage": "胆红素脑病",
        "desc": "神经系统受损"
      }
    ]
  },
  {
    "id": "infant_pneumonia",
    "name": "小儿肺炎",
    "category": "pediatric",
    "intro": "儿童肺部感染，是婴幼儿常见重症。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "呼吸略快、无困难"
      },
      {
        "stage": "中度",
        "desc": "呼吸急促、轻度缺氧"
      },
      {
        "stage": "重度",
        "desc": "明显呼吸困难、需吸氧"
      },
      {
        "stage": "极重",
        "desc": "呼吸衰竭、需机械通气"
      }
    ]
  },
  {
    "id": "fever",
    "name": "发烧",
    "category": "other",
    "intro": "体温升高，是感染等多种疾病的共同表现。",
    "stages": [
      {
        "stage": "低烧",
        "desc": "37.5-38℃、头晕乏力"
      },
      {
        "stage": "高烧",
        "desc": "38-39℃、畏寒发抖"
      },
      {
        "stage": "持续高热",
        "desc": ">39℃、意识模糊风险"
      }
    ]
  },
  {
    "id": "heatstroke",
    "name": "中暑",
    "category": "other",
    "intro": "高温环境致体温调节障碍，重者危及生命。",
    "stages": [
      {
        "stage": "先兆",
        "desc": "头晕、口渴、多汗"
      },
      {
        "stage": "轻症",
        "desc": "恶心、乏力"
      },
      {
        "stage": "重症",
        "desc": "高热、意识障碍"
      }
    ]
  },
  {
    "id": "dehydration",
    "name": "脱水",
    "category": "other",
    "intro": "体液丢失过多或摄入不足，致血容量下降。",
    "stages": [
      {
        "stage": "轻度",
        "desc": "口渴、尿少"
      },
      {
        "stage": "重度",
        "desc": "头晕、皮肤弹性差、心率快"
      }
    ]
  },
  {
    "id": "lymphedema",
    "name": "淋巴水肿",
    "category": "other",
    "intro": "淋巴回流障碍致肢体进行性肿胀。",
    "stages": [
      {
        "stage": "0期",
        "desc": "潜伏期、无可见肿胀"
      },
      {
        "stage": "I-II期",
        "desc": "可凹性水肿、皮肤纤维化"
      },
      {
        "stage": "III期",
        "desc": "不可逆增粗、反复感染"
      }
    ]
  }
];

export default { categories, illnesses };