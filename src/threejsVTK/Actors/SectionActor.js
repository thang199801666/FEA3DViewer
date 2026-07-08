// Actors/SectionActor.js
// Hiển thị MẶT CẮT (cap PolyData từ CutterFilter/ClipClosedSurfaceFilter) theo 3 chế độ:
//   'surface' : mặt đặc 1 màu (hoặc theo scalar nếu bật)
//   'contour' : tô dải màu theo scalar qua LUT + tuỳ chọn đường đẳng trị (GPU)
//   'hatch'   : kẻ gạch kiểu bản vẽ kỹ thuật
//
//   const sec = new SectionActor(cap, { mode: "contour", lookupTable: ctf, range });
//   renderer.addActor(sec); ... sec.setMode("hatch");

import * as THREE from "three";
import { makeContourMaterial } from "../Rendering/ContourShaderMaterial.js";
import { makeHatchMaterial } from "../Rendering/HatchMaterial.js";
import { ContourFilter } from "../Filters/ContourFilter.js";

export class SectionActor extends THREE.Group {
    constructor(capPolyData, options = {}) {
        super();
        this.isActor = true;
        this.name = options.name ?? "Section";
        this.mode = options.mode ?? "surface";
        this.options = {
            color: 0xb0bec5,
            lookupTable: null,
            range: null,
            scalarName: null,
            numBands: 12,
            isolines: true,
            hatch: {},
            ...options,
        };
        this._capData = capPolyData;
        this._mesh = null;
        this._isoLines = null;
        this._geo = this._buildGeometry(capPolyData);
        this.setMode(this.mode);
    }

    _buildGeometry(pd) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(pd.points), 3));
        const tris = pd.getTriangles();
        if (tris.length) geo.setIndex(tris);
        geo.computeVertexNormals();
        return geo;
    }

    _scalar() {
        const pd = this._capData;
        return this.options.scalarName ? pd.pointData.getArray(this.options.scalarName) : pd.pointData.getScalars();
    }

    _range() {
        if (this.options.range) return this.options.range;
        const s = this._scalar();
        return s ? s.getRange(0) : [0, 1];
    }

    setMode(mode) {
        this.mode = mode;
        // Xoá mesh/isolines cũ
        if (this._mesh) { this.remove(this._mesh); this._mesh.material.dispose(); this._mesh = null; }
        if (this._isoLines) { this.remove(this._isoLines); this._isoLines.geometry.dispose(); this._isoLines.material.dispose(); this._isoLines = null; }

        let material;
        if (mode === "contour") {
            const lut = this.options.lookupTable;
            if (!lut) { console.warn("[SectionActor] contour cần lookupTable."); return this.setMode("surface"); }
            const range = this._range();
            const scalar = this._scalar();
            const { material: mat, attachScalar } = makeContourMaterial(lut, {
                numBands: this.options.numBands, range, showIsolines: false,
            });
            if (scalar) attachScalar(this._geo, scalar, range);
            material = mat;

            if (this.options.isolines && scalar) this._addIsolines(range);
        } else if (mode === "hatch") {
            material = makeHatchMaterial(this.options.hatch);
        } else { // surface
            material = new THREE.MeshStandardMaterial({
                color: this.options.color, side: THREE.DoubleSide,
                flatShading: true, roughness: 0.6, metalness: 0.1,
            });
        }

        const mesh = new THREE.Mesh(this._geo, material);
        mesh.name = `${this.name}_${mode}`;
        this._mesh = mesh;
        this.add(mesh);
        return this;
    }

    _addIsolines(range) {
        const iso = new ContourFilter().setInputData(this._capData);
        iso.generateValues(this.options.numBands, range);
        const line = iso.getOutputData();
        if (!line.lines.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(line.points), 3));
        const seg = [];
        for (const l of line.lines) for (let i = 0; i + 1 < l.length; i++) seg.push(l[i], l[i + 1]);
        geo.setIndex(seg);
        const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });
        this._isoLines = new THREE.LineSegments(geo, mat);
        this._isoLines.renderOrder = 1;
        this.add(this._isoLines);
    }

    dispose() {
        if (this._mesh) this._mesh.material.dispose();
        if (this._isoLines) { this._isoLines.geometry.dispose(); this._isoLines.material.dispose(); }
        this._geo.dispose();
    }
}
