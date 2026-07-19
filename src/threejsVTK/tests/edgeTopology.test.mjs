import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ActorTopology } from "../src/interaction/picking/ActorTopology.js";
import { SubPicker } from "../src/interaction/picking/SubPicker.js";
import { PickMode } from "../src/interaction/picking/PickMode.js";

test("closed solid exposes feature edges as selectable line chains", () => {
    const actor = new THREE.Group();
    actor.featureEdgeAngle = 20;
    actor.surface = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));

    const topology = new ActorTopology(actor);

    assert.equal(topology.chains.size, 12);
    for (const [id, chain] of topology.chains) {
        assert.equal(chain.id, id);
        assert.equal(chain.positions.length, 6);
        assert.ok(chain.sphere instanceof THREE.Sphere);
        assert.ok(chain.sphere.radius > 0);
        assert.equal(topology.chainOf(id), chain);
    }
});

test("point picking can hover/click a feature edge", () => {
    const actor = new THREE.Group();
    actor.isActor = true;
    actor.featureEdgeAngle = 20;
    actor.surface = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    actor.add(actor.surface);

    const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100);
    camera.position.set(4, 4, 4);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const picker = new SubPicker({
        camera,
        domElement: { getBoundingClientRect: () => rect },
        getActors: () => [actor],
        tolerancePx: 8,
    });

    const topology = ActorTopology.get(actor);
    let result = null;
    for (const chain of topology.chains.values()) {
        const midpoint = new THREE.Vector3()
            .fromArray(chain.positions, 0)
            .add(new THREE.Vector3().fromArray(chain.positions, 3))
            .multiplyScalar(0.5)
            .project(camera);
        const x = rect.left + (midpoint.x + 1) * rect.width * 0.5;
        const y = rect.top + (1 - midpoint.y) * rect.height * 0.5;
        result = picker.pick(x, y, PickMode.EDGE);
        if (result) break;
    }

    assert.ok(result);
    assert.equal(result.mode, PickMode.EDGE);
    assert.equal(result.actor, actor);
    assert.ok(topology.chainOf(result.id));
});
