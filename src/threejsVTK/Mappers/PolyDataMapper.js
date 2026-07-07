// Mappers/PolyDataMapper.js
// Mô phỏng vtkPolyDataMapper: nhận PolyData, xuất ra THREE.BufferGeometry
// (kèm attribute 'color' nếu có scalars + LookupTable).

import * as THREE from "three";
import { LookupTable } from "./LookupTable.js";

export class PolyDataMapper {
    constructor() {
        this.isPolyDataMapper = true;
        this.input = null;
        this.lookupTable = null;
        this.scalarVisibility = true;   // false = không tô màu theo scalar
        this.scalarRange = null;        // null = tự động lấy theo min/max dữ liệu
        this.colorArrayName = null;     // null = dùng active scalars
        this.colorComponent = 0;        // -1 = magnitude (cho vector)

        // Nội suy scalar TRƯỚC khi ánh xạ màu (giống vtkMapper::InterpolateScalarsBeforeMapping).
        // true  -> ranh giới band sắc nét (kiểu Abaqus), tra bảng màu ở từng pixel qua texture.
        // false -> nội suy màu RGB ở đỉnh (mượt/nhòe band) — hành vi cũ.
        this.interpolateScalarsBeforeMapping = false;
        // false = NearestFilter (đúng ngữ nghĩa lookup table, band sắc nét)
        // true  = LinearFilter (chuyển màu mượt giữa các bậc)
        this.colorTextureLinear = false;
        this.colorTexture = null;       // THREE.DataTexture dựng từ LookupTable
    }

    setInputData(polyData) { this.input = polyData; return this; }
    setLookupTable(lut) { this.lookupTable = lut; return this; }
    setScalarVisibility(v) { this.scalarVisibility = !!v; return this; }
    setScalarRange(min, max) { this.scalarRange = [min, max]; return this; }

    /** Chọn tô màu theo array nào trong pointData. component = -1 để dùng magnitude. */
    setColorBy(arrayName, component = 0) {
        this.colorArrayName = arrayName;
        this.colorComponent = component;
        return this;
    }

    /** Bật/tắt nội suy scalar trước khi ánh xạ màu (giống VTK). */
    setInterpolateScalarsBeforeMapping(v) { this.interpolateScalarsBeforeMapping = !!v; return this; }
    getInterpolateScalarsBeforeMapping() { return this.interpolateScalarsBeforeMapping; }

    /** true = LinearFilter (mượt), false = NearestFilter (band sắc nét kiểu Abaqus). */
    setColorTextureLinear(v) { this.colorTextureLinear = !!v; return this; }

    /** Texture bảng màu 1D hiện hành (Actor dùng làm material.map). */
    getColorTexture() { return this.colorTexture; }

    getLookupTable() {
        if (!this.lookupTable) this.lookupTable = new LookupTable();
        return this.lookupTable;
    }

    _resolveScalars() {
        if (!this.input) return null;
        const pdta = this.input.pointData;
        return this.colorArrayName ? pdta.getArray(this.colorArrayName) : pdta.getScalars();
    }

    /** Range màu đang hiệu lực (auto hoặc do người dùng đặt) — dùng cho ScalarBar. */
    getEffectiveScalarRange() {
        if (this.scalarRange) return this.scalarRange;
        const s = this._resolveScalars();
        return s ? s.getRange(this.colorComponent) : [0, 1];
    }

    /**
     * Xây dựng THREE.BufferGeometry mới từ PolyData hiện tại.
     * Gọi lại hàm này (và dispose geometry cũ) mỗi khi dữ liệu thay đổi.
     */
    buildGeometry() {
        if (!this.input) throw new Error("PolyDataMapper: chưa có input (setInputData)");
        const pd = this.input;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(pd.points, 3));

        const tris = pd.getTriangles();
        if (tris.length > 0) geometry.setIndex(tris);

        // Tô màu theo scalar
        const scalars = this.scalarVisibility ? this._resolveScalars() : null;
        if (scalars && scalars.getNumberOfTuples() === pd.getNumberOfPoints()) {
            const lut = this.getLookupTable();
            const [mn, mx] = this.getEffectiveScalarRange();
            lut.setRange(mn, mx);

            if (this.interpolateScalarsBeforeMapping) {
                // === Nội suy scalar TRƯỚC khi ánh xạ màu (giống VTK) ===
                // Mỗi đỉnh mang toạ độ texture u = scalar chuẩn hoá [0..1]; GPU nội suy u
                // trên tam giác rồi mới tra bảng màu ở từng pixel -> band sắc nét (kiểu Abaqus).
                const uv = this._buildTexCoords(scalars, mn, mx);
                geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
                this._buildColorTexture(lut);
                // KHÔNG set attribute "color": Actor sẽ dùng material.map thay cho vertexColors.
            } else {
                // === Nội suy MÀU (mặc định): tra màu ở đỉnh rồi để GPU trộn RGB -> mượt ===
                const colors = lut.mapScalars(scalars, this.colorComponent);
                geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            }
        }

        if (tris.length > 0) geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    }

    /** Toạ độ texture per-vertex: u = scalar chuẩn hoá [0..1], v = 0.5. */
    _buildTexCoords(scalars, mn, mx) {
        const n = scalars.getNumberOfTuples();
        const uv = new Float32Array(n * 2);
        const span = mx - mn;
        for (let i = 0; i < n; i++) {
            const v = this.colorComponent === -1
                ? scalars.getMagnitude(i)
                : scalars.getComponent(i, this.colorComponent);
            let t = span === 0 ? 0.5 : (v - mn) / span;
            if (Number.isNaN(t)) t = 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            uv[i * 2] = t;
            uv[i * 2 + 1] = 0.5;
        }
        return uv;
    }

    /** Dựng THREE.DataTexture 1D (N x 1) từ LookupTable. */
    _buildColorTexture(lut) {
        const data = lut.getUint8Table();          // Uint8Array(N*4) RGBA
        const n = lut.numberOfColors;
        if (this.colorTexture) this.colorTexture.dispose();

        const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
        const filter = this.colorTextureLinear ? THREE.LinearFilter : THREE.NearestFilter;
        tex.minFilter = filter;
        tex.magFilter = filter;                    // Nearest = giữ nguyên "bậc" của LUT -> band sắc nét
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        // Dùng byte màu như không gian TUYẾN TÍNH để khớp với đường vertexColors
        // (three không tự chuyển đổi màu ở vertex color), tránh lệch tông khi bật/tắt cờ.
        if (THREE.NoColorSpace !== undefined) tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;

        this.colorTexture = tex;
        return tex;
    }

    /** Giải phóng texture khi không dùng nữa. */
    dispose() {
        if (this.colorTexture) { this.colorTexture.dispose(); this.colorTexture = null; }
    }
}