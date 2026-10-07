// 侦察：搜索源覆盖 vs 全仓 App（哪些 App 有内容桶但没进搜索）
import('../apps/memory/global-search-engine.js').then((m) => {
  const src = m.buildDefaultSources({
    get: () => null,
    set: () => true,
  }, { chatContext: () => null });
  const ids = src.map((s) => s.id);
  const appIds = Array.from(new Set(src.map((s) => s.appId).filter(Boolean))).sort();
  console.log('sources=' + ids.length + ' appIds=' + appIds.length);
  console.log(appIds.join(','));
});