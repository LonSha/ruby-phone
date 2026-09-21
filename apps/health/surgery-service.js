/**
 * 手术库服务（v2.60.0）——封装 surgery-library.js，纯本地、零依赖、只读。
 * SURGERY_LIBRARY：59 条术式，每条含 id(ICD编码)/name/alias/chapter/category/
 *   grade(1-4)/intents/anesthesia/recoveryDays/stages/complications/note。
 * stages 由 stageTable 生成，每段 {id,name,typicalMinutes}。
 * 本层提供：章节分组、术式查询、阶段时间合计、分级分布——只读展示，不写状态。
 */
import { SURGERY_LIBRARY } from './surgery-library.js';

const GRADE_LABELS = { 1: '一级', 2: '二级', 3: '三级', 4: '四级' };

// 章节列表（按出现顺序去重），[{ name, count }]
export function surgeryChapters() {
  const order = [];
  const count = {};
  for (const s of SURGERY_LIBRARY) {
    const c = s.chapter || '未分类';
    if (!count[c]) { count[c] = 0; order.push(c); }
    count[c]++;
  }
  return order.map((name) => ({ name, count: count[name] }));
}

// 按章节名过滤术式；不传则全部
export function surgeryByChapter(chapter) {
  if (!chapter) return SURGERY_LIBRARY.slice();
  return SURGERY_LIBRARY.filter((s) => s.chapter === chapter);
}

// 术式各阶段合计分钟数
function surgeryStageMinutes(item) {
  if (!item || !Array.isArray(item.stages)) return 0;
  return item.stages.reduce((sum, st) => sum + (st.typicalMinutes || 0), 0);
}

// 全局统计 { total, chapters, byGrade:{1..4}, avgStageMinutes }
export function surgeryStats() {
  const byGrade = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let totalStage = 0;
  for (const s of SURGERY_LIBRARY) {
    if (byGrade[s.grade] != null) byGrade[s.grade]++;
    totalStage += surgeryStageMinutes(s);
  }
  return {
    total: SURGERY_LIBRARY.length,
    chapters: surgeryChapters().length,
    byGrade,
    avgStageMinutes: SURGERY_LIBRARY.length ? Math.round(totalStage / SURGERY_LIBRARY.length) : 0,
  };
}

// 术式摘要（列表用，剔除 stages 明细，控制 DOM 体积）
export function surgerySummary(item) {
  if (!item) return null;
  return {
    id: item.id, name: item.name, chapter: item.chapter, category: item.category,
    grade: item.grade, gradeLabel: GRADE_LABELS[item.grade] || ('等级' + item.grade),
    anesthesia: item.anesthesia, recoveryDays: item.recoveryDays,
    stageMinutes: surgeryStageMinutes(item), stageCount: (item.stages || []).length,
    complications: (item.complications || []).length, note: item.note || '',
  };
}