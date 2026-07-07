// Actors/LineActor.js
// Hiển thị các cell "lines" của PolyData (ví dụ: kết quả ContourFilter)
// dưới dạng THREE.LineSegments, có thể tô màu theo scalar qua LookupTable.

import * as THREE from "three";

export class LineActor extends THREE.LineSegments {
    constructor(polyData, options = {}) {
        const {
            lookupTable = null,
            scalarRange = null,   // null = tự động
            color = 0x000000,
            component = 0
        } = options;

        const { geometry, hasColors } = LineActor._buildGeometry(
            polyData, lookupTable, scalarRange, component
        );

        const material = new THREE.LineBasicMaterial({
            vertexColors: hasColors,
            color: hasColors ? 0xffffff : color,
            // Lưu ý: linewidth > 1 không được hỗ trợ trên phần lớn trình duyệt (WebGL)
            linewidth: options.linewidth ?? 1,
            depthTest: options.depthTest ?? true
        });

        super(geometry, material);
        this.isActor = true;
        this.isLineActor = true;
        this.polyData = polyData;
        this.name = options.name || "LineActor";
        this._options = { lookupTable, scalarRange, color, component };
    }

    static _buildGeometry(pd, lut, scalarRange, component) {
        const positions = [];
        const colors = [];
        const scalars = pd.pointData.getScalars();
        const useColors = !!(lut && scalars);

        if (useColors) {
            const [mn, mx] = scalarRange || scalars.getRange(component);
            lut.setRange(mn, mx);
        }

        const tmp = [0, 0, 0];
        const pushPoint = (i) => {
            positions.push(pd.points[i * 3], pd.points[i * 3 + 1], pd.points[i * 3 + 2]);
            if (useColors) {
                const v = component === -1 ? scalars.getMagnitude(i) : scalars.getComponent(i, component);
                lut.getColor(v, tmp);
                colors.push(tmp[0], tmp[1], tmp[2]);
            }
        };

        // Mỗi polyline [p0, p1, ..., pn] -> các segment (p0,p1), (p1,p2), ...
        for (const line of pd.lines) {
            for (let i = 0; i + 1 < line.length; i++) {
                pushPoint(line[i]);
                pushPoint(line[i + 1]);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        if (useColors) {
            geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        }
        geometry.computeBoundingSphere();
        return { geometry, hasColors: useColors };
    }

    /** Rebuild khi polyData thay đổi. */
    update(polyData = this.polyData) {
        this.polyData = polyData;
        const o = this._options;
        const old = this.geometry;
        const { geometry, hasColors } = LineActor._buildGeometry(
            polyData, o.lookupTable, o.scalarRange, o.component
        );
        this.geometry = geometry;
        if (old) old.dispose();
        this.material.vertexColors = hasColors;
        this.material.needsUpdate = true;
        return this;
    }

    dispose() {
        if (this.geometry) this.geometry.dispose();
        if (this.material) this.material.dispose();
    }
}