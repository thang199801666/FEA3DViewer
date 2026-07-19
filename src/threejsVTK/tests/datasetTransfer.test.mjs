import assert from "node:assert/strict";
import { DataArray } from "../src/core/FieldData.js";
import { CellArray } from "../src/core/CellArray.js";
import { PolyData } from "../src/core/PolyData.js";
import { UnstructuredGrid } from "../src/core/UnstructuredGrid.js";
import { deserializeDataSet, serializeDataSet } from "../src/io/datasetTransfer.js";

console.log("\nDataset transfer");

const poly = new PolyData();
poly.setPoints(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
poly.setPolys([[0, 1, 2]]);
poly.pointData.addArray(new DataArray("temperature", new Float64Array([1, 2, 3]), 1), { asScalars: true });
poly.userData.sourceCells = CellArray.fromRaggedArray([[0, 1, 2]]);
poly.userData.polySourceCellMap = new Int32Array([7]);

const restoredPoly = deserializeDataSet(serializeDataSet(poly));
assert.ok(restoredPoly instanceof PolyData);
assert.deepEqual(Array.from(restoredPoly.points), Array.from(poly.points));
assert.deepEqual(Array.from(restoredPoly.polys.connectivity), [0, 1, 2]);
assert.ok(restoredPoly.pointData.getArray("temperature").values instanceof Float64Array);
assert.equal(restoredPoly.pointData.activeScalars, "temperature");
assert.ok(restoredPoly.userData.sourceCells instanceof CellArray);
assert.deepEqual(Array.from(restoredPoly.userData.polySourceCellMap), [7]);

const grid = new UnstructuredGrid();
grid.setPoints(poly.points);
grid.setCells(new Int32Array([0, 1, 2, 0]), new Int32Array([0, 4]), new Uint8Array([10]));
grid.cellData.addArray(new DataArray("part", new Float32Array([4]), 1), { asScalars: true });
const restoredGrid = deserializeDataSet(serializeDataSet(grid));
assert.ok(restoredGrid instanceof UnstructuredGrid);
assert.deepEqual(Array.from(restoredGrid.connectivity), [0, 1, 2, 0]);
assert.deepEqual(Array.from(restoredGrid.offsets), [0, 4]);
assert.deepEqual(Array.from(restoredGrid.cellTypes), [10]);
assert.equal(restoredGrid.cellData.getArray("part").getComponent(0), 4);

console.log("  ok  PolyData and UnstructuredGrid retain typed arrays, attributes and mappings");
