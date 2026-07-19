import assert from "node:assert/strict";
import * as THREE from "three";
import { partitionGeometry, buildLODGeometries } from "../src/rendering/LargeModelLOD.js";
import { PolyData } from "../src/core/PolyData.js";
import { PolyDataMapper } from "../src/mappers/PolyDataMapper.js";
import { LargeModelActor } from "../src/actors/LargeModelActor.js";

console.log("\nLarge model partition/LOD");
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0,
], 3));
geometry.setAttribute("color", new THREE.Float32BufferAttribute([
    1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1,
], 3));
geometry.setIndex([0, 1, 2, 1, 3, 2]);
geometry.userData.cellMap = new Int32Array([10, 20]);

const partitions = partitionGeometry(geometry, { maxTriangles: 1 });
assert.equal(partitions.length, 2);
assert.deepEqual(partitions.map((item) => item.userData.cellMap[0]), [10, 20]);
assert.ok(partitions.every((item) => item.getAttribute("color")?.count === 3));
const coarse = buildLODGeometries(geometry, { ratios: [1, 0.5] })[1];
assert.ok(coarse.index.count > 0 && coarse.index.count <= geometry.index.count);
assert.ok(coarse.userData.simplifier.startsWith("vertex-clustering"));
console.log("  ok  partition preserves attributes and source-cell mapping");

const data = new PolyData();
data.setPoints(geometry.getAttribute("position").array.slice());
data.setPolys([[0, 1, 2], [1, 3, 2]]);
const actor = new LargeModelActor(new PolyDataMapper().setInputData(data), "large", {
    maxTrianglesPerPartition: 1,
});
assert.equal(actor.largeModelLOD.levels.length, 3);
assert.equal(actor.surface.userData.isPickingProxy, true);
assert.equal(actor.surface.material.visible, false);
actor.showModelWithEdges();
assert.equal(actor.largeModelLOD.visible, true);
assert.equal(actor.surface.material.visible, false);
assert.ok(actor.buildPickingBVHNow());
assert.ok(actor.surface.geometry.boundsTree);
const previousLOD = actor.largeModelLOD;
actor.update();
assert.notEqual(actor.largeModelLOD, previousLOD);
assert.equal(actor.surface.material.visible, false);
actor.dispose();
console.log("  ok  LargeModelActor retains picking proxy and rebuilds LOD after updates");
