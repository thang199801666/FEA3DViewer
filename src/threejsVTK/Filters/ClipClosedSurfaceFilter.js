// Filters/ClipClosedSurfaceFilter.js  (đã sửa)
// Cắt mesh bề mặt (khối kín) bằng mặt phẳng VÀ bù lấp mặt cắt để trông vẫn "đặc".
// Kết hợp ClipFilter (thân) + CutterFilter (nắp). Nắp giờ mang theo cả boundary edge
// (out.lines) + scalars nội suy để tô contour.
//
//   const clip = new ClipClosedSurfaceFilter()
//       .setPlane([1,0,0], [0,0,0]).setCapping(true);
//   clip.setInputData(surface);
//   const whole = clip.getOutputData(); // thân + nắp (+ nắp có lines viền)
//   const cap   = clip.getCap();        // chỉ nắp (fill + viền + scalars)
//   const edge  = clip.getCapContour(); // chỉ đường viền mặt cắt (out.lines)
//   const body  = clip.getBody();

import { Filter } from "./Filter.js";
import { PolyData, DataArray } from "../Core/PolyData.js";
import { ClipFilter } from "./ClipFilter.js";
import { CutterFilter } from "./CutterFilter.js";

export class ClipClosedSurfaceFilter extends Filter {
    constructor() {
        super();
        this.normal = [1, 0, 0];
        this.origin = [0, 0, 0];
        this.insideOut = false;
        this.capping = true;
    }

    setPlane(normal, origin) { this.normal = [...normal]; this.origin = [...origin]; return this; }
    setInsideOut(v) { this.insideOut = !!v; return this; }
    setCapping(v) { this.capping = !!v; return this; }

    // Pháp tuyến nắp: LUÔN dùng đúng mặt phẳng cắt của thân để nắp khớp đúng vị trí cắt.
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

    // Nắp: mặt phẳng bù lấp + viền + scalars.
    getCap() {
        return new CutterFilter()
            .setPlane(this._capNormal(), this.origin)
            .setFill(true)
            .setEdges(true)
            .setInputData(this.input)
            .getOutputData();
    }

    // Chỉ đường viền mặt cắt (dùng vẽ contour đường rời).
    getCapContour() {
        return new CutterFilter()
            .setPlane(this._capNormal(), this.origin)
            .setFill(false)
            .setInputData(this.input)
            .getOutputData();
    }

    getOutputData() {
        if (!this.input) throw new Error("ClipClosedSurfaceFilter: chưa có input");
        const body = this.getBody();
        if (!this.capping) return body;
        const cap = this.getCap();
        return _merge(body, cap);
    }
}

// Gộp hai PolyData bề mặt thành một, gắn cellData "IsCap" (0 thân, 1 nắp).
// Gộp cả out.lines của nắp (boundary edge) sau khi dời chỉ số.
function _merge(body, cap) {
    const out = new PolyData();
    const bN = body.getNumberOfPoints();
    out.setPoints(Float32Array.from([...body.points, ...cap.points]));

    out.polys = [
        ...body.polys.map(c => [...c]),
        ...cap.polys.map(c => c.map(i => i + bN)),
    ];

    // Boundary edge của nắp (body thường không có lines).
    const bodyLines = body.lines || [];
    const capLines = cap.lines || [];
    if (bodyLines.length || capLines.length) {
        out.lines = [
            ...bodyLines.map(l => [...l]),
            ...capLines.map(l => l.map(i => i + bN)),
        ];
    }

    // Point arrays: gộp theo tên.
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

    // Cell flag phân biệt nắp/thân (per-poly).
    const isCap = new Float32Array(body.polys.length + cap.polys.length);
    isCap.fill(0, 0, body.polys.length);
    isCap.fill(1, body.polys.length);
    out.cellData.addArray(new DataArray("IsCap", isCap, 1));
    return out;
}