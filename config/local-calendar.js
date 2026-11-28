/* Project an explicit instant in the device's local calendar; never read the clock. */
export function localParts(ms) {
    if (!Number.isFinite(ms)) return null;
    const value = new Date(ms);
    if (!Number.isFinite(value.getTime())) return null;
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate(),
        hour: value.getHours(), minute: value.getMinutes(), second: value.getSeconds() };
}

export function localDayStart(year, month, day) {
    const value = new Date(year, month - 1, day);
    if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) return null;
    return value.getTime();
}
