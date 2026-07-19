const MAX_ENTRIES = 100;
const entries = [];

export function recordPerformance(entry) {
    const value = { timestamp: Date.now(), ...entry };
    entries.push(value);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("threejsvtk:performance", { detail: value }));
    }
    return value;
}

export function getPerformanceEntries() {
    return entries.slice();
}

export function clearPerformanceEntries() {
    entries.length = 0;
}
