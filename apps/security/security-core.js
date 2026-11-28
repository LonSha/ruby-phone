export function planAccessRecord(file, actor, action, at) {
  const line = `[${at}] ${actor} 执行了高危操作: ${action}`;
  const leakIndex = Math.min(1.0, +(file.leakIndex + 0.45).toFixed(2));
  return { line, leakIndex };
}
