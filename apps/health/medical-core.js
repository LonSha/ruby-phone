/* ========================================================
 * medical-core 精简纯逻辑移植 (源自 LA-0.6.84 medical-core)
 * 保留纯规则状态机: 病症库/规范化/推进/分级/到期/查询
 * 剔除 LLM prompt / 存储 / 子嗣归并 / 报告解析
 * 演示说明: 语义移植, 实现为自包含可维护代码 (零依赖零LLM)
 * ======================================================== */
'use strict';
import { categories as ILLNESS_CATEGORIES, illnesses as ILLNESS_LIBRARY } from '../../data/illness-library.js';

// ---- 病程五型 ----
export const COURSES = ['acute', 'chronic', 'congenital', 'obstetric', 'injury'];
export const COURSE_LABELS = { acute: '急性·自限', chronic: '慢性·分级', congenital: '先天', obstetric: '产科', injury: '限期恢复' };
export const OUTCOMES = ['ongoing', 'recovered', 'chronic', 'treated', 'deceased'];
export const OUTCOME_LABELS = { ongoing: '进行中', recovered: '已痊愈', chronic: '慢性', treated: '已处置', deceased: '已故' };
export const SEVERITIES = ['mild', 'moderate', 'severe', 'critical', 'normal'];
export const SEVERITY_LABELS = { mild: '轻度', moderate: '中度', severe: '重度', critical: '危重', normal: '正常' };
export const SEVERITY_GRADE = { mild: 'g1', moderate: 'g2', severe: 'g3', critical: 'g4', normal: 'g1' };
export const SEVERITY_CN = { '轻度': 'mild', '轻': 'mild', '中度': 'moderate', '中': 'moderate', '重度': 'severe', '重': 'severe', '危重': 'critical', '危急': 'critical', '正常': 'normal', '未见异常': 'normal' };
export const STATUS_CN = { '待明确': 'pending', '已明确': 'confirmed', '已排除': 'ruled_out' };
export const CONGENITAL_CONDITIONS = [
    '先天性心脏异常', '神经管发育异常', '遗传代谢异常', '骨骼发育异常',
    '听力/视力发育异常', '发育迟缓倾向',
];
export const OBSTETRIC_RE = /产后|产道|剖宫产|恶露|会阴|子痫|乳腺炎|胎膜|胎盘/;
export const NEONATAL_RE = /早产儿|过期产儿|极早产|呼吸适应|失温|感染观察|出生损伤|新生儿|黄疸|缺氧/;
export const NEEDS_FOR_EFFECT = ['hunger', 'thirst', 'clean', 'bladder', 'bowel'];
export const CHRONIC_DRIFT_P = 0.15;
export const ACUTE_TO_CHRONIC_P = { mild: 0.02, moderate: 0.06, severe: 0.12, critical: 0.2, '': 0.05 };

// 病症→病程分配表（急性 / 慢性两大组；先天/产科/伤单独标）
export const COURSE_ASSIGN = {
    acute: [
        'cold', 'flu', 'pharyngitis', 'pneumonia', 'covid', 'ards', 'pulmonary_embolism',
        'myocardial_infarction', 'aortic_dissection', 'deep_vein_thrombosis', 'shock',
        'gastroenteritis', 'diarrhea', 'pancreatitis', 'cholecystitis',
        'hepatic_encephalopathy', 'liver_failure',
        'uti', 'acute_kidney_injury', 'epididymitis', 'balanitis',
        'hypoglycemia',
        'stroke', 'bells_palsy',
        'conjunctivitis', 'gingivitis', 'vestibular_neuritis',
        'dengue', 'malaria', 'hand_foot_mouth', 'pertussis', 'sepsis', 'tetanus', 'cholera', 'rabies',
        'pelvic_inflammatory_disease', 'neonatal_jaundice', 'infant_pneumonia',
        'fever', 'heatstroke', 'dehydration',
    ],
    chronic: [
        'allergic_rhinitis', 'asthma', 'copd', 'osa', 'bronchiectasis', 'pulmonary_fibrosis', 'tuberculosis',
        'hypertension', 'coronary_heart_disease', 'heart_failure', 'atrial_fibrillation',
        'pulmonary_hypertension', 'aortic_stenosis', 'varicose_veins',
        'constipation', 'gastritis', 'peptic_ulcer', 'gerd', 'ulcerative_colitis', 'crohns', 'gallstones',
        'fatty_liver', 'cirrhosis', 'hepatitis_b', 'hepatitis_c',
        'chronic_kidney_disease', 'nephritis', 'bph', 'prostatitis', 'varicocele',
        'diabetes', 'diabetic_retinopathy', 'diabetic_nephropathy', 'diabetic_foot', 'obesity',
        'osteoporosis', 'hyperthyroidism', 'hypothyroidism', 'cushing', 'gout',
        'migraine', 'parkinson', 'alzheimer', 'multiple_sclerosis', 'myasthenia_gravis', 'als', 'epilepsy',
        'insomnia', 'depression', 'bipolar', 'anxiety', 'ocd', 'schizophrenia',
        'osteoarthritis', 'scoliosis', 'cervical_spondylosis', 'spondylolisthesis', 'ankylosing_spondylitis',
        'rheumatoid_arthritis', 'sle', 'sjogren', 'scleroderma', 'allergy',
        'psoriasis', 'eczema', 'hidradenitis', 'acne', 'pemphigus',
        'glaucoma', 'cataract', 'amd', 'keratoconus',
        'hearing_loss', 'periodontitis',
        'hiv', 'syphilis',
        'gastric_cancer', 'colorectal_cancer', 'breast_cancer', 'lung_cancer', 'cervical_cancer',
        'prostate_cancer', 'liver_cancer', 'ovarian_cancer', 'melanoma',
        'anemia', 'leukemia', 'thrombocytopenia', 'aplastic_anemia', 'multiple_myeloma', 'mds',
        'dysmenorrhea', 'endometriosis',
        'lymphedema',
    ],
    congenital: [],
    obstetric: ['preeclampsia'],
    injury: ['traumatic_brain_injury', 'spinal_cord_injury', 'pressure_injury', 'burn'],
};
export const COURSE_BY_ID = (() => {
    const map = {};
    for (const course of COURSES) for (const id of (COURSE_ASSIGN[course] || [])) map[id] = course;
    return map;
})();

// 急性病默认病程天数（按分类 + 个别覆盖）
export const ACUTE_DAY_BY_CATEGORY = {
    respiratory: 10, cardiovascular: 21, digestive: 7, hepatobiliary: 14, renal_urinary: 10,
    endocrine_metabolic: 14, neurological: 21, psychiatric: 30, musculoskeletal: 21, rheumatic_immune: 30,
    dermatological: 14, ophthalmology: 10, ent: 10, infectious: 14, oncology: 30, hematologic: 21,
    gynecological: 10, urology: 14, pediatric: 10, other: 7,
};
export const ACUTE_DAY_TOTAL = {
    cold: 7, flu: 7, pharyngitis: 10, pneumonia: 14, covid: 14, ards: 21, pulmonary_embolism: 28,
    myocardial_infarction: 28, aortic_dissection: 21, deep_vein_thrombosis: 21, shock: 7,
    gastroenteritis: 5, diarrhea: 5, pancreatitis: 14, cholecystitis: 14,
    hepatic_encephalopathy: 14, liver_failure: 21,
    uti: 7, acute_kidney_injury: 14, epididymitis: 14, balanitis: 10,
    hypoglycemia: 1, stroke: 28, bells_palsy: 42,
    conjunctivitis: 10, gingivitis: 14, vestibular_neuritis: 14,
    dengue: 14, malaria: 14, hand_foot_mouth: 10, pertussis: 42, sepsis: 28, tetanus: 42, cholera: 14, rabies: 60,
    pelvic_inflammatory_disease: 14, neonatal_jaundice: 14, infant_pneumonia: 14,
    fever: 3, heatstroke: 3, dehydration: 3,
};
export const DEFAULT_ACUTE_DAYS = 7;

// ---- 基础工具 ----
export function str(v) { return v == null ? '' : String(v); }
export function numOrNull(v) {
    const s = (v === null || v === undefined) ? '' : String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
export function clampInt(v, dflt, lo, hi) {
    const n = numOrNull(v);
    return n == null ? dflt : Math.min(hi, Math.max(lo, Math.round(n)));
}
export function oneOf(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
export function firstStr(...vals) {
    for (const v of vals) { const s = str(v).trim(); if (s) return s; }
    return '';
}
export function cnStatus(v) { const s = str(v).trim(); return STATUS_CN[s] || s; }
export function cnSeverity(v) { const s = str(v).trim(); return SEVERITY_CN[s] || s; }
export function severityGrade(severity) { return SEVERITY_GRADE[severity] || 'g0'; }
export function severityLabel(severity) { return SEVERITY_LABELS[severity] || '未定'; }

// ---- 日期工具 ----
export function todayIso(now) {
    const d = new Date(now == null ? Date.now() : now);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return Number.isFinite(t) ? t : null;
}
export function addDaysIso(iso, days) {
    const t = parseIso(iso);
    if (t == null) return '';
    return new Date(t + (Number(days) || 0) * 86400000).toISOString().slice(0, 10);
}
export function daysLeft(expiresAt, today) {
    const a = parseIso(expiresAt), b = parseIso(today);
    if (a == null || b == null) return null;
    return Math.round((a - b) / 86400000);
}
export function expiryText(cond, today) {
    const left = daysLeft(cond && cond.expiresAt, today);
    if (left == null) return cond && cond.course === 'congenital' ? '永久' : '';
    if (left > 0) return '剩 ' + left + ' 天';
    if (left === 0) return '今天到期';
    return '已过期 ' + Math.abs(left) + ' 天';
}

// ---- 病症库查询 ----
export function filterIllnesses(query, category) {
    const q = String(query || '').trim().toLowerCase();
    return ILLNESS_LIBRARY.filter(il => {
        if (category && category !== 'all' && il.category !== category) return false;
        if (!q) return true;
        const hay = (il.name + ' ' + (il.intro || '') + ' ' + (il.stages || []).map(s => (s.stage || '') + (s.desc || '')).join(' ')).toLowerCase();
        return hay.indexOf(q) >= 0;
    });
}
export function illnessCategoryLabel(id) {
    const c = ILLNESS_CATEGORIES.find(x => x.id === id);
    return c ? c.label : String(id || '其他');
}
export function libraryEntry(id) {
    const k = str(id);
    if (!k) return null;
    return ILLNESS_LIBRARY.find(x => x.id === k) || null;
}
export function libraryEntryByName(name) {
    const n = str(name).trim();
    if (!n) return null;
    return ILLNESS_LIBRARY.find(x => x.name === n) || null;
}
export function libraryAll() { return ILLNESS_LIBRARY.slice(); }

// ---- 病程判定 ----
export function courseOfName(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    if (CONGENITAL_CONDITIONS.includes(n) || /先天|发育异常|发育迟缓/.test(n)) return 'congenital';
    if (OBSTETRIC_RE.test(n)) return 'obstetric';
    if (NEONATAL_RE.test(n)) return 'injury';
    return '';
}
export function courseOf(entry) {
    if (!entry) return '';
    if (COURSES.indexOf(str(entry.course)) >= 0) return str(entry.course);
    const lib = libraryEntry(entry.id) || libraryEntryByName(entry.name);
    if (lib && COURSE_BY_ID[lib.id]) return COURSE_BY_ID[lib.id];
    return courseOfName(entry.name);
}
export function courseLabel(course) { return COURSE_LABELS[course] || '未分类'; }
export function categoryLabel(id) {
    const key = str(id);
    if (key === 'obstetric') return '产科';
    if (key === 'neonatal') return '新生儿';
    if (key === 'congenital') return '先天';
    if (key === 'custom') return '其他状态';
    return illnessCategoryLabel(key);
}

// ---- 病症规范化 ----
export function normalizeCondition(input) {
    const c = (input && typeof input === 'object') ? input : {};
    const lib = c.libId ? libraryEntry(c.libId) : (c.name ? libraryEntryByName(c.name) : null);
    const name = firstStr(c.name, lib && lib.name);
    const legacyKind = str(c.kind);
    const isCustom = str(c.category) === 'custom' || (!lib && (legacyKind === 'temp' || legacyKind === 'custom'));
    const stages = Array.isArray(c.stages) && c.stages.length
        ? c.stages.map(s => ({ stage: str(s && s.stage), desc: str(s && s.desc), days: numOrNull(s && s.days) }))
        : (lib && Array.isArray(lib.stages) ? lib.stages.map(s => ({ stage: str(s.stage), desc: str(s.desc), days: numOrNull(s.days) })) : []);
    /* [v3.12.0] 此处手动拼的「非空且有限」等价判据在 `true` 上会漏：`Number(true) === 1`
     *  ⇒ 一个布尔形态的 stageIndex 会被读成「第 1 阶段」。改走本地强口径（同一份实现）。 */
    const storedIdxNum = numOrNull(c.stageIndex);
    const storedIndex = storedIdxNum !== null ? Math.max(0, storedIdxNum) : 0;
    const clampedIndex = stages.length ? Math.min(stages.length - 1, storedIndex) : 0;
    const stageName = firstStr(c.stage, (stages[clampedIndex] || {}).stage);
    const stageIndex = c.stage ? stageIndexOf({ stages }, stageName) : clampedIndex;
    const effect = (c.effect && typeof c.effect === 'object' && NEEDS_FOR_EFFECT.includes(c.effect.target))
        ? { target: c.effect.target, multiplier: Number(c.effect.multiplier) || 1 }
        : null;
    return {
        id: firstStr(c.id),
        libId: firstStr(c.libId, lib && lib.id),
        name,
        category: firstStr(c.category, lib && lib.category, isCustom ? 'custom' : 'other'),
        course: firstStr(c.course, courseOf(lib), isCustom ? '' : courseOfName(name)) || (isCustom ? '' : 'acute'),
        stages,
        stageIndex,
        stage: stageName || (stages[stageIndex] || {}).stage || '',
        desc: firstStr(c.desc, (stages[stageIndex] || {}).desc),
        stageStartedAt: firstStr(c.stageStartedAt),
        outcome: oneOf(str(c.outcome), OUTCOMES, 'ongoing'),
        untilDays: numOrNull(c.untilDays),
        expiresAt: firstStr(c.expiresAt),
        effect,
        severity: oneOf(cnSeverity(c.severity), SEVERITIES, '') || oneOf(str(c.severity), SEVERITIES, ''),
        selfLimiting: c.selfLimiting === undefined ? (firstStr(c.course, courseOf(lib)) === 'acute') : !!c.selfLimiting,
        public: c.public === undefined ? true : !!c.public,
        source: oneOf(str(c.source), ['physio', 'delivery', 'congenital', 'clinic', 'exam', 'ai-drafted', 'manual'], isCustom ? 'manual' : 'physio'),
        birthId: firstStr(c.birthId),
        note: str(c.note),
        screening: c.screening === true,
        stepId: firstStr(c.stepId),
        tentative: c.tentative === true,
        history: Array.isArray(c.history) ? c.history.map(h => ({ at: str(h && h.at), from: str(h && h.from), to: str(h && h.to), reason: str(h && h.reason) })) : [],
        isMedical: !isCustom && !!name,
    };
}
export function stageIndexOf(entry, stageName) {
    if (!entry || !Array.isArray(entry.stages)) return 0;
    const i = entry.stages.findIndex(s => str(s && s.stage) === str(stageName));
    return i < 0 ? 0 : i;
}
export function isCurrentCondition(cond, today) {
    const c = (cond && cond.course !== undefined) ? cond : normalizeCondition(cond);
    if (!c.name) return false;
    if (c.outcome && c.outcome !== 'ongoing' && c.outcome !== 'chronic') return false;
    const left = daysLeft(c.expiresAt, today);
    if (left != null && left <= 0) return false;
    return true;
}
export function conditionLine(cond, opts = {}) {
    const c = (cond && cond.course !== undefined) ? cond : normalizeCondition(cond);
    if (!c.name) return '';
    const bits = [c.name];
    if (opts.withStage && c.stage) bits.push(c.stage);
    if (c.outcome === 'recovered') bits.push('已痊愈');
    else if (c.outcome === 'chronic') bits.push('慢性');
    else if (c.outcome === 'treated') bits.push('已处置');
    else if (c.outcome === 'deceased') bits.push('已故');
    else {
        const exp = expiryText(c, opts.today);
        if (exp) bits.push(exp);
    }
    return bits.join(' · ');
}
export function countText(n, unit) { return String(n) + ' ' + unit; }

// ---- 状态推进 ----
// 确定性随机（种子 → [0,1)）
export function hashSeed(text) {
    let h = 0;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    }
    return h >>> 0;
}
export function seededRng(seed) {
    let a = hashSeed(seed) || 1;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function advanceConditionOnce(input, ctx = {}) {
    const c = normalizeCondition(input);
    const today = firstStr(ctx.today, todayIso());
    const seedBase = str(ctx.seedBase);
    if (!c.name) return c;
    if (c.screening) return c;
    if (c.outcome === 'recovered' || c.outcome === 'deceased' || c.outcome === 'treated') return c;
    if (c.outcome === 'chronic' && c.course !== 'chronic') return c;
    const course = c.course || courseOfName(c.name);
    if (course === 'congenital') return c;
    const injuryHasStages = course === 'injury' && (Array.isArray(c.stages) ? c.stages : [])
        .some(st => st && numOrNull(st.days) != null);
    if (course === 'obstetric' || (course === 'injury' && !injuryHasStages)) {
        const exp = firstStr(c.expiresAt, (c.untilDays != null && c.stageStartedAt) ? addDaysIso(c.stageStartedAt, c.untilDays) : '');
        if (!exp) return c;
        if (daysLeft(exp, today) > 0) return { ...c, expiresAt: exp };
        return { ...c, expiresAt: exp, outcome: 'recovered' };
    }
    if (course === 'chronic') {
        const n = c.stages.length;
        if (n < 2) return c;
        const rng = seededRng(seedBase + '|' + c.id + '|' + today);
        if (rng() >= CHRONIC_DRIFT_P) return c;
        // 慢性波动：轻微升降（0/±1，不越界）
        const delta = rng() < 0.5 ? -1 : 1;
        const nextIdx = Math.max(0, Math.min(n - 1, c.stageIndex + delta));
        if (nextIdx === c.stageIndex) return c;
        const nextStage = c.stages[nextIdx];
        return {
            ...c,
            stageIndex: nextIdx,
            stage: nextStage.stage,
            desc: nextStage.desc,
            stageStartedAt: c.stageStartedAt || today,
            history: (c.history || []).concat([{ at: today, from: (c.stages[c.stageIndex] || {}).stage, to: nextStage.stage, reason: '慢性波动' }]),
        };
    }
    // acute：按阶段推进
    const n = c.stages.length;
    if (n === 0) {
        // 无阶段表：用到期语义
        const totalDays = ACUTE_DAY_TOTAL[c.id] || ACUTE_DAY_BY_CATEGORY[c.category] || DEFAULT_ACUTE_DAYS;
        const exp = firstStr(c.expiresAt, c.stageStartedAt ? addDaysIso(c.stageStartedAt, totalDays) : '');
        if (!exp) return c;
        if (daysLeft(exp, today) > 0) return { ...c, expiresAt: exp };
        return { ...c, expiresAt: exp, outcome: 'recovered' };
    }
    if (c.stageIndex >= n - 1) {
        // 最后一阶段 → 到期康复
        const exp = firstStr(c.expiresAt, c.stageStartedAt ? addDaysIso(c.stageStartedAt, 3) : '');
        return { ...c, expiresAt: exp, outcome: (c.untilDays != null || true) ? 'recovered' : 'recovered' };
    }
    // 推进到下一阶段
    const next = c.stages[c.stageIndex + 1];
    const days = numOrNull(next && next.days);
    return {
        ...c,
        stageIndex: c.stageIndex + 1,
        stage: next.stage,
        desc: next.desc,
        stageStartedAt: c.stageStartedAt || today,
        expiresAt: days != null ? addDaysIso(today, days) : c.expiresAt,
        history: (c.history || []).concat([{ at: today, from: c.stage, to: next.stage, reason: '进展' }]),
    };
}
export function advanceConditions(input = {}) {
    const today = firstStr(input.today, todayIso());
    const seedBase = firstStr(input.seed, str(input.subjectKey));
    const list = (Array.isArray(input.conditions) ? input.conditions : []).map(c => normalizeCondition(c));
    const changes = [];
    const next = list.map(c => {
        const after = advanceConditionOnce(c, { today, seedBase });
        if (after.outcome !== c.outcome) {
            changes.push({ id: c.id, name: c.name, kind: c.outcome === 'ongoing' && after.outcome === 'recovered' ? 'recover' : 'outcome', from: c.outcome, to: after.outcome, at: today });
        } else if (after.stageIndex !== c.stageIndex) {
            changes.push({ id: c.id, name: c.name, kind: c.course === 'chronic' ? 'drift' : 'stage', from: c.stage, to: after.stage, at: today });
        } else if (!c.stageStartedAt && after.stageStartedAt) {
            changes.push({ id: c.id, name: c.name, kind: 'start', from: '', to: after.stageStartedAt, at: today });
        }
        return after;
    });
    return { today, conditions: next, changes, checked: true };
}

// ---- 病症库导出 ----
export const IllnessLibrary = {
    categories: ILLNESS_CATEGORIES,
    illnesses: ILLNESS_LIBRARY,
};

export default {
    IllnessLibrary,
    COURSES, COURSE_LABELS, COURSE_ASSIGN, COURSE_BY_ID,
    OUTCOMES, OUTCOME_LABELS, SEVERITIES, SEVERITY_LABELS, SEVERITY_GRADE,
    filterIllnesses, illnessCategoryLabel, libraryEntry, libraryEntryByName, libraryAll,
    courseOf, courseOfName, courseLabel, categoryLabel,
    normalizeCondition, stageIndexOf, isCurrentCondition, conditionLine, countText,
    todayIso, parseIso, addDaysIso, daysLeft, expiryText,
    advanceConditionOnce, advanceConditions,
};