import earcut from "earcut";
import { PolyData } from "../core/PolyData.js";

/** Rectangular plate aligned with XZ, including true cylindrical through-holes. */
export class PerforatedPlateSource {
    constructor({ width = 4.5, length = 5, thickness = 0.25, holes = [], holeSegments = 24, center = [0, 0, 0] } = {}) {
        this.width = width;
        this.length = length;
        this.thickness = thickness;
        this.holes = holes;
        this.holeSegments = Math.max(12, holeSegments | 0);
        this.center = center;
    }

    getOutputDataWithScalars(name = "stress") {
        const halfWidth = this.width / 2;
        const halfLength = this.length / 2;
        const rings = [[[-halfWidth, -halfLength], [halfWidth, -halfLength], [halfWidth, halfLength], [-halfWidth, halfLength]]];
        for (const hole of this.holes) {
            const ring = [];
            for (let i = 0; i < this.holeSegments; i++) {
                const angle = -i * Math.PI * 2 / this.holeSegments;
                ring.push([hole.x + Math.cos(angle) * hole.radius, hole.z + Math.sin(angle) * hole.radius]);
            }
            rings.push(ring);
        }

        const flat = [];
        const holeIndices = [];
        let offset = 0;
        rings.forEach((ring, index) => {
            if (index > 0) holeIndices.push(offset);
            ring.forEach(([x, z]) => flat.push(x, z));
            offset += ring.length;
        });
        const triangles = earcut(flat, holeIndices, 2);
        const vertexCount = flat.length / 2;
        const [cx, cy, cz] = this.center;
        const points = [];
        for (const y of [cy - this.thickness / 2, cy + this.thickness / 2]) {
            for (let i = 0; i < vertexCount; i++) points.push(cx + flat[i * 2], y, cz + flat[i * 2 + 1]);
        }
        const polys = [];
        for (let i = 0; i < triangles.length; i += 3) {
            const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
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
        const values = new Float32Array(points.length / 3);
        for (let i = 0; i < values.length; i++) values[i] = Math.hypot(points[i * 3] - cx, points[i * 3 + 2] - cz);
        output.addPointDataArray(name, values, 1, { setActiveScalar: true });
        return output;
    }
}

export default PerforatedPlateSource;
