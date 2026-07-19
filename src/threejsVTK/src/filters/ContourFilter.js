import { Filter } from "./Filter.js";
import { PolyData } from "../core/PolyData.js";
import { tryContourLinesWasm } from "../wasm/surfaceExtractorWasm.js";

export class ContourFilter extends Filter {
    constructor() {
        super();
        this.isoValues = [0.5];
        this.scalarArrayName = null;
    }

    setValue(v) { this.isoValues = [v]; return this; }
    setValues(values) { this.isoValues = [...values]; return this; }

    generateValues(n, [mn, mx]) {
        this.isoValues = [];
        for (let i = 0; i < n; i++) this.isoValues.push(mn + (mx - mn) * (i + 0.5) / n);
        return this;
    }

    setScalarArrayName(name) { this.scalarArrayName = name; return this; }

    getOutputData() {
        const input = this.input;
        if (!input) throw new Error("ContourFilter: Input is not set.");

        const points = input.points;
        const tris = input.getTriangles();
        const scalarArr = this.scalarArrayName
            ? input.pointData.getArray(this.scalarArrayName)
            : input.pointData.getScalars();

        if (!scalarArr) {
            console.warn("[ContourFilter] PolyData does not have active scalars.");
            return new PolyData();
        }
        const scalars = scalarArr.values;

        const accelerated = tryContourLinesWasm(points, tris, scalars, this.isoValues);
        if (accelerated) {
            const out = new PolyData();
            out.setPoints(accelerated.points);
            const lineIndices = new Int32Array(accelerated.points.length / 3);
            for (let i = 0; i < lineIndices.length; ++i) lineIndices[i] = i;
            out.setLines(lineIndices);
            if (accelerated.scalars.length) {
                out.addPointDataArray("Contour", accelerated.scalars, 1, { setActiveScalar: true });
            }
            return out;
        }

        const outPoints = [];
        const outLines = [];
        const outScalars = [];

        const interp = (iA, iB, iso) => {
            const sA = scalars[iA], sB = scalars[iB];
            const t = (iso - sA) / (sB - sA);
            const k = 3;
            return [
                points[iA * k]     + (points[iB * k]     - points[iA * k])     * t,
                points[iA * k + 1] + (points[iB * k + 1] - points[iA * k + 1]) * t,
                points[iA * k + 2] + (points[iB * k + 2] - points[iA * k + 2]) * t,
            ];
        };

        for (const iso of this.isoValues) {
            for (let c = 0; c + 2 < tris.length; c += 3) {
                const ia = tris[c], ib = tris[c + 1], ic = tris[c + 2];
                const sa = scalars[ia], sb = scalars[ib], sc = scalars[ic];
                const edges = [[ia, ib, sa, sb], [ib, ic, sb, sc], [ic, ia, sc, sa]];
                const crossings = [];
                for (const [p1, p2, s1, s2] of edges) {
                    const lo = Math.min(s1, s2), hi = Math.max(s1, s2);
                    if (iso >= lo && iso <= hi && s1 !== s2) crossings.push(interp(p1, p2, iso));
                }
                if (crossings.length === 2) {
                    const base = outPoints.length / 3;
                    outPoints.push(...crossings[0], ...crossings[1]);
                    outLines.push([base, base + 1]);
                    outScalars.push(iso, iso);
                }
            }
        }

        const out = new PolyData();
        out.setPoints(Float32Array.from(outPoints));
        out.lines = outLines;
        if (outScalars.length) out.addPointDataArray("Contour", outScalars, 1, { setActiveScalar: true });
        return out;
    }
}
