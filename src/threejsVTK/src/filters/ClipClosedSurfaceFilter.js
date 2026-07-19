import { Filter } from "./Filter.js";
import { PolyData, DataArray } from "../core/PolyData.js";
import { ClipFilter } from "./ClipFilter.js";
import { CutterFilter } from "./CutterFilter.js";

export class ClipClosedSurfaceFilter extends Filter {
    constructor() {
        super();
        this.normal = [1, 0, 0];
        this.origin = [0, 0, 0];
        this.insideOut = false;
        this.capping = true;
        this.capInput = null;
    }

    setPlane(normal, origin) { this.normal = [...normal]; this.origin = [...origin]; return this; }
    setInsideOut(v) { this.insideOut = !!v; return this; }
    setCapping(v) { this.capping = !!v; return this; }
    setCapInputData(input) { this.capInput = input; return this; }

    _capNormal() {
        return this.insideOut ? [...this.normal] : this.normal.map(x => -x);
    }

    getBody() {
        return new ClipFilter()
            .setPlane(this.normal, this.origin)
            .setInsideOut(this.insideOut)
            .setInputData(this.input)
            .getOutputData();
    }

    getCap() {
        return new CutterFilter()
            .setPlane(this._capNormal(), this.origin)
            .setFill(true)
            .setEdges(true)
            .setInputData(this.capInput ?? this.input)
            .getOutputData();
    }

    getCapContour() {
        return new CutterFilter()
            .setPlane(this._capNormal(), this.origin)
            .setFill(false)
            .setInputData(this.capInput ?? this.input)
            .getOutputData();
    }

    getOutputData() {
        if (!this.input) throw new Error("ClipClosedSurfaceFilter: Input is not set.");
        const body = this.getBody();
        if (!this.capping) return body;
        const cap = this.getCap();
        return _merge(body, cap);
    }
}

function _merge(body, cap) {
    const out = new PolyData();
    const bN = body.getNumberOfPoints();
    const points = new Float32Array(body.points.length + cap.points.length);
    points.set(body.points, 0);
    points.set(cap.points, body.points.length);
    out.setPoints(points);

    out.polys = [
        ...body.polys.map(c => [...c]),
        ...cap.polys.map(c => c.map(i => i + bN)),
    ];

    const bodyLines = body.lines || [];
    const capLines = cap.lines || [];
    if (bodyLines.length || capLines.length) {
        out.lines = [
            ...bodyLines.map(l => [...l]),
            ...capLines.map(l => l.map(i => i + bN)),
        ];
    }

    for (const a of body.pointData.arrays.values()) {
        const capA = cap.pointData.getArray(a.name);
        const merged = new Float32Array(a.values.length + (capA ? capA.values.length : cap.getNumberOfPoints() * a.numberOfComponents));
        merged.set(a.values, 0);
        if (capA) merged.set(capA.values, a.values.length);
        out.pointData.addArray(new DataArray(a.name, merged, a.numberOfComponents), {
            asScalars: body.pointData.activeScalars === a.name,
            asVectors: body.pointData.activeVectors === a.name,
        });
    }

    const isCap = new Float32Array(body.polys.length + cap.polys.length);
    isCap.fill(0, 0, body.polys.length);
    isCap.fill(1, body.polys.length);
    out.cellData.addArray(new DataArray("IsCap", isCap, 1));
    return out;
}
