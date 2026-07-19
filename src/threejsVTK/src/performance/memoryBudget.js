export function getMemoryBudget() {
    const deviceGB = Number(globalThis.navigator?.deviceMemory) || 4;
    // Browsers rarely allow a tab to consume all physical RAM. Keep a conservative ceiling.
    const budgetBytes = Math.min(6, Math.max(1, deviceGB * 0.45)) * 1024 ** 3;
    return { deviceGB, budgetBytes };
}

export function assessVTKFileMemory(fileBytes, { retainedWorker = false } = {}) {
    const { deviceGB, budgetBytes } = getMemoryBudget();
    // File buffer + parsed arrays + render arrays/indices + temporary partition/LOD data.
    const multiplier = retainedWorker ? 3.4 : 2.6;
    const estimatedPeakBytes = fileBytes * multiplier;
    return {
        deviceGB,
        budgetBytes,
        estimatedPeakBytes,
        ratio: estimatedPeakBytes / budgetBytes,
        level: estimatedPeakBytes > budgetBytes ? "reject" : estimatedPeakBytes > budgetBytes * 0.7 ? "warning" : "ok",
    };
}
