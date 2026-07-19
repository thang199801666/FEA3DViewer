import assert from "node:assert/strict";
import { VTKLegacyStreamReader } from "../src/io/VTKLegacyStreamReader.js";

console.log("\nVTK out-of-core stream reader");
const text = `# vtk DataFile Version 3.0
stream fixture
ASCII
DATASET UNSTRUCTURED_GRID
POINTS 4 float
0 0 0  1 0 0  0 1 0  0 0 1
CELLS 1 5
4 0 1 2 3
CELL_TYPES 1
10
POINT_DATA 4
SCALARS stress float 1
LOOKUP_TABLE default
1 2 3 4
VECTORS U float
0 0 0  1 0 0  0 1 0  0 0 1
`;
const progress = [];
const output = await new VTKLegacyStreamReader().parseFile(new File([text], "fixture.vtk"), {
    onProgress: (message) => progress.push(message.progress),
});
assert.equal(output.getNumberOfPoints(), 4);
assert.equal(output.getNumberOfCells(), 4);
assert.equal(output.polys.length, 4);
assert.deepEqual(Array.from(output.pointData.getArray("stress").values), [1, 2, 3, 4]);
assert.equal(output.pointData.getArray("U").numberOfComponents, 3);
assert.equal(progress.at(-1), 1);
console.log("  ok  parses unstructured cells, scalars and vectors directly from File.stream()");
