import { PolyData } from '../Core/PolyData.js';
import { Filter } from './Filter.js';

/**
 * ContourFilter - Trích xuất đường đồng mức (Isoline) trên bề mặt lưới tam giác,
 * dựa trên trường Scalars đang active. Tương tự vtkContourFilter, nhưng áp dụng
 * cho bề mặt (surface mesh) thay vì khối (volume) — nên dùng thuật toán
 * "Marching Triangles" thay vì Marching Cubes/Tetrahedra:
 *
 * Với mỗi tam giác, kiểm tra lần lượt 3 cạnh; nếu isoValue nằm giữa 2 đỉnh của
 * 1 cạnh thì nội suy tuyến tính ra điểm cắt. Một tam giác bị cắt hợp lệ sẽ luôn
 * cho đúng 2 điểm giao -> nối chúng lại thành 1 đoạn thẳng (line segment).
 */
export class ContourFilter extends Filter {
    constructor() {
        super();
        this.isoValues = [0.5]; // Có thể trích xuất nhiều đường đồng mức cùng lúc
    }

    setValue(value) { this.isoValues = [value]; return this; }
    setValues(values) { this.isoValues = values; return this; }

    requestData(input) {
        const points = input.getPoints();
        const polys = input.getPolys();
        const scalars = input.getScalars();

        if (!scalars) {
            console.warn('[ContourFilter] PolyData không có Scalars active, không thể tính contour.');
            return new PolyData();
        }

        const outPoints = [];
        const outLines = [];
        const outScalars = []; // giá trị isoValue tại mỗi điểm sinh ra, dùng để tô màu đường theo mức

        const interp = (iA, iB, isoValue) => {
            const sA = scalars[iA], sB = scalars[iB];
            const t = (isoValue - sA) / (sB - sA);
            const ax = points[iA * 3], ay = points[iA * 3 + 1], az = points[iA * 3 + 2];
            const bx = points[iB * 3], by = points[iB * 3 + 1], bz = points[iB * 3 + 2];
            return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
        };

        for (const isoValue of this.isoValues) {
            for (let c = 0; c < polys.length; c += 3) {
                const ia = polys[c], ib = polys[c + 1], ic = polys[c + 2];
                const sa = scalars[ia], sb = scalars[ib], sc = scalars[ic];

                const edges = [[ia, ib, sa, sb], [ib, ic, sb, sc], [ic, ia, sc, sa]];
                const crossings = [];

                for (const [p1, p2, s1, s2] of edges) {
                    const lo = Math.min(s1, s2), hi = Math.max(s1, s2);
                    if (isoValue >= lo && isoValue <= hi && s1 !== s2) {
                        crossings.push(interp(p1, p2, isoValue));
                    }
                }

                // Tam giác bị isoValue cắt ngang đúng nghĩa luôn cho ra chính xác 2 điểm giao
                if (crossings.length === 2) {
                    const baseIndex = outPoints.length / 3;
                    outPoints.push(...crossings[0], ...crossings[1]);
                    outLines.push(baseIndex, baseIndex + 1);
                    outScalars.push(isoValue, isoValue);
                }
            }
        }

        const output = new PolyData();
        output.setPoints(outPoints);
        output.setLines(outLines);
        output.setPolys([]); // Contour chỉ sinh line, không có mặt tam giác
        if (outScalars.length > 0) {
            output.addPointDataArray('Contour', outScalars, 1, { setActiveScalar: true });
        }
        return output;
    }
}
