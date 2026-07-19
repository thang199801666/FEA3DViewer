import { PolyData } from "../core/PolyData.js";

function appendPrism(points, polys, sides, radius, y0, y1, angleOffset = 0) {
    const base = points.length / 3;
    for (const y of [y0, y1]) {
        for (let i = 0; i < sides; i++) {
            const angle = angleOffset + i * Math.PI * 2 / sides;
            points.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        }
    }
    for (let i = 0; i < sides; i++) {
        const next = (i + 1) % sides;
        polys.push([base + i, base + next, base + sides + next], [base + i, base + sides + next, base + sides + i]);
    }
    for (let i = 1; i < sides - 1; i++) {
        polys.push([base, base + i + 1, base + i]);
        polys.push([base + sides, base + sides + i, base + sides + i + 1]);
    }
}

/** Hex-head anchor bolt aligned with the Y axis and based at Y=0. */
export class HexBoltSource {
    constructor({ radius = 0.12, shaftLength = 0.5, headRadius = radius * 1.65, headHeight = radius * 1.5, shaftSegments = 16 } = {}) {
        this.radius = radius;
        this.shaftLength = shaftLength;
        this.headRadius = headRadius;
        this.headHeight = headHeight;
        this.shaftSegments = Math.max(8, shaftSegments | 0);
    }

    getOutputData() {
        const points = [];
        const polys = [];
        appendPrism(points, polys, this.shaftSegments, this.radius, 0, this.shaftLength);
        appendPrism(points, polys, 6, this.headRadius, this.shaftLength, this.shaftLength + this.headHeight, Math.PI / 6);
        const output = new PolyData();
        output.setPoints(Float32Array.from(points));
        output.setPolys(polys);
        return output;
    }
}

export default HexBoltSource;
