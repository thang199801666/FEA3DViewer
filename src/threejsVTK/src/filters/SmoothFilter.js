import { Filter } from "./Filter.js";
import { PolyData, DataArray } from "../core/PolyData.js";
import { trySmoothPointsWasm } from "../wasm/surfaceExtractorWasm.js";

export class SmoothFilter extends Filter {
    constructor() {
        super();
        this.iterations = 20;
        this.relaxationFactor = 0.1;
    }

    setIterations(n) { this.iterations = n; return this; }
    setRelaxationFactor(f) { this.relaxationFactor = f; return this; }

    getOutputData() {
        const pd = this.input;
        if (!pd) throw new Error("SmoothFilter: Input is not set.");

        const nPts = pd.getNumberOfPoints();
        const tris = pd.getTriangles();

        const accelerated = trySmoothPointsWasm(
            pd.points, tris, this.iterations, this.relaxationFactor,
        );
        if (accelerated) return this._buildOutput(pd, accelerated);

        const neighbors = Array.from({ length: nPts }, () => new Set());
        for (let t = 0; t < tris.length; t += 3) {
            const a = tris[t], b = tris[t + 1], c = tris[t + 2];
            neighbors[a].add(b); neighbors[a].add(c);
            neighbors[b].add(a); neighbors[b].add(c);
            neighbors[c].add(a); neighbors[c].add(b);
        }

        let cur = Float32Array.from(pd.points);
        let next = new Float32Array(cur.length);
        const k = this.relaxationFactor;

        for (let it = 0; it < this.iterations; it++) {
            for (let i = 0; i < nPts; i++) {
                const nb = neighbors[i];
                if (nb.size === 0) {
                    next[i * 3] = cur[i * 3];
                    next[i * 3 + 1] = cur[i * 3 + 1];
                    next[i * 3 + 2] = cur[i * 3 + 2];
                    continue;
                }
                let ax = 0, ay = 0, az = 0;
                for (const j of nb) {
                    ax += cur[j * 3]; ay += cur[j * 3 + 1]; az += cur[j * 3 + 2];
                }
                const inv = 1 / nb.size;
                next[i * 3] = cur[i * 3] + k * (ax * inv - cur[i * 3]);
                next[i * 3 + 1] = cur[i * 3 + 1] + k * (ay * inv - cur[i * 3 + 1]);
                next[i * 3 + 2] = cur[i * 3 + 2] + k * (az * inv - cur[i * 3 + 2]);
            }
            [cur, next] = [next, cur];
        }

        return this._buildOutput(pd, cur);
    }

    _buildOutput(pd, points) {
        const out = new PolyData();
        out.setPoints(points);
        out.verts = pd.verts.map(c => [...c]);
        out.lines = pd.lines.map(c => [...c]);
        out.polys = pd.polys.map(c => [...c]);
        out.strips = pd.strips.map(c => [...c]);
        for (const a of pd.pointData.arrays.values()) {
            out.pointData.addArray(
                new DataArray(a.name, Float32Array.from(a.values), a.numberOfComponents),
                { asScalars: pd.pointData.activeScalars === a.name }
            );
        }
        return out;
    }
}
