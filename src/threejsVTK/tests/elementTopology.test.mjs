import test from "node:test";
import assert from "node:assert/strict";
import { VTKLegacyReader } from "../src/io/VTKLegacyReader.js";
import { PolyDataMapper } from "../src/mappers/PolyDataMapper.js";
import { Actor } from "../src/actors/Actor.js";
import { ActorTopology } from "../src/interaction/picking/ActorTopology.js";
import { SelectionHighlighter } from "../src/interaction/highlight/SelectionHighlighter.js";
import { PickMode } from "../src/interaction/picking/PickMode.js";

function topology(type, points, connectivity) {
    const vtk = `# vtk DataFile Version 3.0
element topology
ASCII
DATASET UNSTRUCTURED_GRID
POINTS ${points.length / 3} float
${points.join(" ")}
CELLS 1 ${connectivity.length + 1}
${connectivity.length} ${connectivity.join(" ")}
CELL_TYPES 1
${type}
`;
    const data = new VTKLegacyReader().parse(new TextEncoder().encode(vtk));
    const actor = new Actor(new PolyDataMapper().setInputData(data));
    return ActorTopology.get(actor).elementOfCell(0);
}

function actorFor(type, points, connectivity) {
    const vtk = `# vtk DataFile Version 3.0
element highlight
ASCII
DATASET UNSTRUCTURED_GRID
POINTS ${points.length / 3} float
${points.join(" ")}
CELLS 1 ${connectivity.length + 1}
${connectivity.length} ${connectivity.join(" ")}
CELL_TYPES 1
${type}
`;
    const data = new VTKLegacyReader().parse(new TextEncoder().encode(vtk));
    return new Actor(new PolyDataMapper().setInputData(data));
}

test("tetra element has four faces and six edges", () => {
    const e = topology(10, [0,0,0, 1,0,0, 0,1,0, 0,0,1], [0,1,2,3]);
    assert.equal(e.triangles.length / 3, 4);
    assert.equal(e.edges.length, 6);
});

test("quad element has one face and four edges", () => {
    const e = topology(9, [0,0,0, 1,0,0, 1,1,0, 0,1,0], [0,1,2,3]);
    assert.equal(e.triangles.length / 3, 2);
    assert.equal(e.edges.length, 4);
});

test("line element has one edge and two points", () => {
    const e = topology(3, [0,0,0, 1,0,0], [0,1]);
    assert.deepEqual(e.edges, [[0,1]]);
    assert.deepEqual(e.points, [0,1]);
});

test("quadratic edge includes its mid-side node", () => {
    const e = topology(21, [0,0,0, 1,0,0, 0.5,0.2,0], [0,1,2]);
    assert.deepEqual(e.edges, [[0,2,1]]);
    assert.deepEqual(e.points, [0,1,2]);
});

test("hex element hover builds a complete overlay without runtime errors", () => {
    const actor = actorFor(12, [
        0,0,0, 1,0,0, 1,1,0, 0,1,0,
        0,0,1, 1,0,1, 1,1,1, 0,1,1,
    ], [0,1,2,3,4,5,6,7]);
    const highlighter = new SelectionHighlighter();
    assert.doesNotThrow(() => highlighter.setHover({
        actor, mode: PickMode.ELEMENT, id: 0, key: `${actor.uuid}:element:0`,
    }));
    assert.equal(highlighter._hover.children.length, 2);
    highlighter.dispose();
});
