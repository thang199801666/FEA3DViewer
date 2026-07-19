import assert from "node:assert/strict";
import * as THREE from "three";
import { PolyData, DataArray } from "../src/core/PolyData.js";
import { PolyDataMapper } from "../src/mappers/PolyDataMapper.js";
import { Actor } from "../src/actors/Actor.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("  ok  " + name); pass++; } catch (error) { console.log("  FAIL " + name + "\n       " + error.message); fail++; } };

function makeActor(userData = {}) {
  const data = new PolyData();
  data.setPoints(new Float32Array([0,0,0, 1,0,0, 0,1,0]));
  data.setPolys([[0,1,2]]);
  data.pointData.addArray(new DataArray("stress", new Float32Array([0, 0.5, 1]), 1), { asScalars: true });
  data.userData = userData;
  return new Actor(new PolyDataMapper().setInputData(data), "test");
}

console.log("\nShell contour material");

t("shell contour is visible from both faces", () => {
  const actor = makeActor({ hasSurfaceCells: true, hasVolumeCells: false });
  actor.setScalarVisibility(true);
  assert.equal(actor.surface.material.side, THREE.DoubleSide);
});

t("plain PolyData defaults to double-sided contour", () => {
  const actor = makeActor();
  actor.setScalarVisibility(true);
  assert.equal(actor.surface.material.side, THREE.DoubleSide);
});

t("surface extracted from a volume keeps front-face culling", () => {
  const actor = makeActor({ hasVolumeCells: true });
  actor.setScalarVisibility(true);
  assert.equal(actor.surface.material.side, THREE.FrontSide);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
