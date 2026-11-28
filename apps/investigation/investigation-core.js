/* A phone shutdown before the brake cannot be evidence of a later shutdown. */
export function hasFollowingShutdown(logs, brakeTime) {
  return logs.some(event => {
    if (event.device !== 'smartphone' || event.eventType !== 'POWER_OFF') return false;
    const delay = event.timestamp - brakeTime;
    return delay >= 0 && delay < 60000;
  });
}
