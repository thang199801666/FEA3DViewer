import assert from "node:assert/strict";
import { assessVTKFileMemory, getMemoryBudget } from "../src/performance/memoryBudget.js";

console.log("\nMemory budget");
const budget = getMemoryBudget();
assert.ok(budget.budgetBytes >= 1024 ** 3);
assert.equal(assessVTKFileMemory(10 * 1024 ** 2).level, "ok");
const large = assessVTKFileMemory(budget.budgetBytes, { retainedWorker: true });
assert.equal(large.level, "reject");
assert.ok(large.estimatedPeakBytes > large.budgetBytes);
console.log("  ok  estimates safe budget and warns before oversized imports");
