import earcut from "earcut";
import { PolyData } from "../core/PolyData.js";

/** Extrudes one closed XZ profile, with optional holes, along the Y axis. */
export class ExtrudedProfileSource {
    constructor({ outer = [], holes = [], height = 1, center = [0, 0, 0] } = {}) {
        this.outer = outer;
        this.holes = holes;
        this.height = height;
        this.center = center;
    }

    getOutputData() {
        const rings = [this.outer, ...this.holes].filter((ring) => ring.length >= 3);
        if (rings.length === 0) return new PolyData();

        const flat = [];
        const holeIndices = [];
        let vertexCount = 0;
        rings.forEach((ring, index) => {
            if (index > 0) holeIndices.push(vertexCount);
            ring.forEach(([x, z]) => flat.push(x, z));
            vertexCount += ring.length;
        });

        const capTriangles = earcut(flat, holeIndices, 2);
        const [cx, cy, cz] = this.center;
        const points = [];
        for (const y of [cy - this.height / 2, cy + this.height / 2]) {
            for (let i = 0; i < vertexCount; i++) {
                points.push(cx + flat[i * 2], y, cz + flat[i * 2 + 1]);
            }
        }

        const polys = [];
        for (let i = 0; i < capTriangles.length; i += 3) {
            const a = capTriangles[i];
            const b = capTriangles[i + 1];
            const c = capTriangles[i + 2];
            polys.push([a, c, b], [vertexCount + a, vertexCount + b, vertexCount + c]);
        }

        let ringOffset = 0;
        rings.forEach((ring) => {
            for (let i = 0; i < ring.length; i++) {
                const a = ringOffset + i;
                const b = ringOffset + (i + 1) % ring.length;
                polys.push([a, b, vertexCount + b], [a, vertexCount + b, vertexCount + a]);
            }
            ringOffset += ring.length;
        });

        const output = new PolyData();
        output.setPoints(Float32Array.from(points));
        output.setPolys(polys);
        return output;
    }
}

export default ExtrudedProfileSource;
