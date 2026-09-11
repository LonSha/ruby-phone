/**
 * 本地子嗣/家谱
 * 结构移植自 LA-0.6.37 family-core，去掉世界书投影与分娩医学结算
 */

function uid() {
  return 'birth-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function emptyLineage() {
  return { births: [] };
}

export function normalizeLineage(input) {
  const src = input && typeof input === 'object' ? input : {};
  const births = Array.isArray(src.births) ? src.births : [];
  return {
    births: births.map((item) => ({
      id: String(item?.id || uid()),
      name: String(item?.name || '未命名').trim() || '未命名',
      gender: String(item?.gender || '未知'),
      father: String(item?.father || '未知'),
      mother: String(item?.mother || ''),
      race: String(item?.race || '人类'),
      embryoType: String(item?.embryoType || '胎生'),
      bornAt: Number(item?.bornAt) || Date.now(),
      note: String(item?.note || ''),
    })),
  };
}

export function addBirth(lineage, payload = {}) {
  const next = normalizeLineage(lineage);
  next.births.unshift({
    id: payload.id || uid(),
    name: String(payload.name || ('孩子' + (next.births.length + 1))).trim(),
    gender: String(payload.gender || '未知'),
    father: String(payload.father || '未知'),
    mother: String(payload.mother || ''),
    race: String(payload.race || '人类'),
    embryoType: String(payload.embryoType || '胎生'),
    bornAt: Number(payload.bornAt) || Date.now(),
    note: String(payload.note || ''),
  });
  next.births = next.births.slice(0, 40);
  return next;
}

export function removeBirth(lineage, id) {
  const next = normalizeLineage(lineage);
  next.births = next.births.filter((item) => item.id !== id);
  return next;
}
