// threejsVTK/Picking/Picker.js
// ---------------------------------------------------------------------------
// Picker — lớp pick lõi của thư viện (tương đương vtkCellPicker + vtkPointPicker).
// Đây là NƠI DUY NHẤT chứa logic raycast; mọi controller/tool khác (hover,
// select, probe, measure...) đều dùng lại lớp này thay vì tự tạo Raycaster.
//
// Quy ước ánh xạ VTK:
//   geometry.userData.cellMap  : Int32Array  triangleIndex -> PolyData cell id
//   geometry.userData.pointMap : Int32Array  bufferVertex  -> PolyData point id
//
// "renderer" là bất kỳ object nào thỏa interface tối thiểu:
//   { camera, scene, domElement?, getProps?(), getActorForObject?(obj) }
// (SceneController hiện tại của bạn đã thỏa interface này.)
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// Scratch objects — tái sử dụng để tránh cấp phát mỗi lần pick (hover gọi rất dày).
const _ndc = new THREE.Vector2();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();

/**
 * @typedef {Object} PickResult
 * @property {Object|null}    actor         Actor (Group có cờ isActor) chứa mesh trúng ray
 * @property {THREE.Object3D} object        Mesh/Line thực sự trúng ray
 * @property {THREE.Vector3}  worldPosition Giao điểm (world space)
 * @property {number}         distance      Khoảng cách từ camera
 * @property {number|null}    cellId        Cell id trong PolyData gốc
 * @property {number|null}    pointId       Point id gần giao điểm nhất
 */

export class Picker {
  /**
   * @param {Object}   [options]
   * @param {Object}   [options.renderer]  Renderer/SceneController mặc định (có thể override per-pick)
   * @param {boolean}  [options.recursive] Duyệt đệ quy children khi intersect (mặc định true)
   * @param {Function} [options.filter]    (object3D) => boolean — loại helper (grid, gizmo, overlay...)
   */
  constructor({ renderer = null, recursive = true, filter = null } = {}) {
    this.renderer = renderer;
    this.raycaster = new THREE.Raycaster();
    this.recursive = recursive;
    this.filter = filter;
    /** @type {PickResult|null} */
    this.lastResult = null;
  }

  setRenderer(renderer) { this.renderer = renderer; return this; }
  setFilter(filter)     { this.filter = filter;     return this; }

  /** Cho phép chỉnh threshold pick Points/Line giống vtkPicker.SetTolerance */
  setTolerance({ points, line } = {}) {
    if (points != null) this.raycaster.params.Points.threshold = points;
    if (line != null) this.raycaster.params.Line.threshold = line;
    return this;
  }

  // ------------------------------------------------------------- public API

  /**
   * Pick theo tọa độ NDC (x, y ∈ [-1, 1], y hướng lên — chuẩn three.js).
   * @returns {PickResult|null}
   */
  pick(ndcX, ndcY, renderer = this.renderer, targets = null) {
    if (!renderer) throw new Error('Picker: renderer is required');

    _ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(_ndc, renderer.camera);

    const list = targets ?? this._defaultTargets(renderer);
    const hits = this.raycaster.intersectObjects(list, this.recursive);
    const hit = hits.find((h) => this._accept(h.object));

    if (!hit) {
      this.lastResult = null;
      return null;
    }

    const vertexIndex = this._nearestVertexIndex(hit);
    this.lastResult = {
      actor: this._resolveActor(hit.object, renderer),
      object: hit.object,
      worldPosition: hit.point.clone(),
      distance: hit.distance,
      cellId: this._cellId(hit.object, hit.faceIndex),
      pointId: this._pointId(hit.object, vertexIndex),
    };
    return this.lastResult;
  }

  /**
   * Pick theo tọa độ chuột (event.clientX/Y). Tự quy đổi sang NDC dựa trên
   * bounding rect của renderer.domElement — controller không cần tự tính nữa.
   */
  pickFromClient(clientX, clientY, renderer = this.renderer, targets = null) {
    if (!renderer?.domElement) throw new Error('Picker: renderer.domElement is required for pickFromClient');
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    return this.pick(x, y, renderer, targets);
  }

  /**
   * Pick theo normalized display coords kiểu VTK (x, y ∈ [0, 1], gốc dưới-trái).
   */
  pickNormalized(nx, ny, renderer = this.renderer, targets = null) {
    return this.pick(nx * 2 - 1, ny * 2 - 1, renderer, targets);
  }

  // Truy vấn kết quả gần nhất — API kiểu VTK
  getActor()        { return this.lastResult?.actor ?? null; }
  getPickPosition() { return this.lastResult?.worldPosition ?? null; }
  getCellId()       { return this.lastResult?.cellId ?? null; }
  getPointId()      { return this.lastResult?.pointId ?? null; }

  // ---------------------------------------------------------------- private

  _defaultTargets(renderer) {
    const props = renderer.getProps?.();
    return props?.length ? props : [renderer.scene];
  }

  _accept(obj) {
    // Một object bị ẩn (hoặc nằm trong nhánh cha bị ẩn) không được pick
    for (let cur = obj; cur; cur = cur.parent) {
      if (!cur.visible) return false;
    }
    return this.filter ? this.filter(obj) : true;
  }

  /** Ưu tiên hook của renderer; fallback: leo cây tìm Group có cờ isActor */
  _resolveActor(object, renderer) {
    if (typeof renderer.getActorForObject === 'function') {
      const actor = renderer.getActorForObject(object);
      if (actor) return actor;
    }
    for (let cur = object; cur; cur = cur.parent) {
      if (cur.isActor) return cur;
    }
    return null;
  }

  _cellId(object, faceIndex) {
    if (faceIndex == null) return null;
    const map = object.geometry?.userData?.cellMap;
    return map ? map[faceIndex] : faceIndex;
  }

  _pointId(object, vertexIndex) {
    if (vertexIndex == null) return null;
    const map = object.geometry?.userData?.pointMap;
    return map ? map[vertexIndex] : vertexIndex;
  }

  _nearestVertexIndex(hit) {
    const pos = hit.object.geometry?.attributes?.position;
    if (!hit.face || !pos) return null;
    const { a, b, c } = hit.face;
    const m = hit.object.matrixWorld;
    _va.fromBufferAttribute(pos, a).applyMatrix4(m);
    _vb.fromBufferAttribute(pos, b).applyMatrix4(m);
    _vc.fromBufferAttribute(pos, c).applyMatrix4(m);
    const p = hit.point;
    const d0 = p.distanceToSquared(_va);
    const d1 = p.distanceToSquared(_vb);
    const d2 = p.distanceToSquared(_vc);
    if (d0 <= d1 && d0 <= d2) return a;
    if (d1 <= d2) return b;
    return c;
  }
}