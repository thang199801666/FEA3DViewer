import { Filter } from "./Filter.js";
import { PolyData, DataArray, CellArray } from "../core/PolyData.js";
import { tryClipTrianglesWasm } from "../wasm/surfaceExtractorWasm.js";

export class ClipFilter extends Filter {
    constructor() {
        super();
        this.normal = [1, 0, 0];
        this.origin = [0, 0, 0];
        this.insideOut = false;
    }

    setPlane(normal, origin) {
        this.normal = [...normal];
        this.origin = [...origin];
        return this;
    }

    setInsideOut(v) { this.insideOut = !!v; return this; }

    getOutputData() {
        const pd = this.input;
        if (!pd) throw new Error("ClipFilter: Input is not set.");

        const [nx, ny, nz] = this.normal;
        const [ox, oy, oz] = this.origin;
        const sign = this.insideOut ? -1 : 1;
        const pts = pd.points;
        const tris = pd.getTriangles();

        const accelerated = tryClipTrianglesWasm(pts, tris, this.normal, this.origin, this.insideOut);
        if (accelerated) {
            const out = new PolyData();
            out.setPoints(accelerated.points);
            out.setPolys(CellArray.fromOffsetsConnectivity(
                accelerated.polyOffsets, accelerated.polyConnectivity,
            ));
            for (const source of pd.pointData.arrays.values()) {
                const components = source.numberOfComponents;
                const values = new Float32Array(accelerated.sourceA.length * components);
                for (let i = 0; i < accelerated.sourceA.length; ++i) {
                    const a = accelerated.sourceA[i], b = accelerated.sourceB[i];
                    const amount = accelerated.amount[i];
                    for (let c = 0; c < components; ++c) {
                        const valueA = source.getComponent(a, c);
                        values[i * components + c] = b < 0
                            ? valueA
                            : valueA + amount * (source.getComponent(b, c) - valueA);
                    }
                }
                out.pointData.addArray(new DataArray(source.name, values, components), {
                    asScalars: pd.pointData.activeScalars === source.name,
                    asVectors: pd.pointData.activeVectors === source.name,
                });
            }
            return out;
        }

        const dist = (i) => sign * (
            nx * (pts[i * 3] - ox) +
            ny * (pts[i * 3 + 1] - oy) +
            nz * (pts[i * 3 + 2] - oz)
        );

        const srcArrays = [...pd.pointData.arrays.values()];
        const outArrays = srcArrays.map(a => ({ src: a, vals: [] }));
        const outPts = [];
        const outPolys = [];

        const emit = (i0, i1 = -1, t = 0) => {
            const idx = outPts.length / 3;
            if (i1 < 0) {
                outPts.push(pts[i0 * 3], pts[i0 * 3 + 1], pts[i0 * 3 + 2]);
                for (const oa of outArrays) {
                    const nC = oa.src.numberOfComponents;
                    for (let c = 0; c < nC; c++) oa.vals.push(oa.src.getComponent(i0, c));
                }
            } else {
                for (let k = 0; k < 3; k++) {
                    outPts.push(pts[i0 * 3 + k] + t * (pts[i1 * 3 + k] - pts[i0 * 3 + k]));
                }
                for (const oa of outArrays) {
                    const nC = oa.src.numberOfComponents;
                    for (let c = 0; c < nC; c++) {
                        const v0 = oa.src.getComponent(i0, c);
                        const v1 = oa.src.getComponent(i1, c);
                        oa.vals.push(v0 + t * (v1 - v0));
                    }
                }
            }
            return idx;
        };

        for (let t = 0; t < tris.length; t += 3) {
            const idx3 = [tris[t], tris[t + 1], tris[t + 2]];
            const d = idx3.map(dist);
            const inside = d.map(v => v >= 0);
            const nIn = inside.filter(Boolean).length;

            if (nIn === 0) continue;

            if (nIn === 3) {
                outPolys.push([emit(idx3[0]), emit(idx3[1]), emit(idx3[2])]);
                continue;
            }

            const poly = [];
            for (let e = 0; e < 3; e++) {
                const a = e, b = (e + 1) % 3;
                if (inside[a]) poly.push(emit(idx3[a]));
                if (inside[a] !== inside[b]) {
                    const tt = d[a] / (d[a] - d[b]);
                    poly.push(emit(idx3[a], idx3[b], tt));
                }
            }
            if (poly.length >= 3) outPolys.push(poly);
        }

        const out = new PolyData();
        out.setPoints(Float32Array.from(outPts));
        out.polys = outPolys;
        for (const oa of outArrays) {
            out.pointData.addArray(
                new DataArray(oa.src.name, Float32Array.from(oa.vals), oa.src.numberOfComponents),
                { asScalars: pd.pointData.activeScalars === oa.src.name }
            );
        }
        return out;
    }
}
