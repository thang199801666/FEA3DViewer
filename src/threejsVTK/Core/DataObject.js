// Core/DataObject.js
// Lớp cơ sở cho MỌI đối tượng dữ liệu (tương đương vtkDataObject).
// Giữ metadata, "modified time" (MTime) để cache/pipeline biết khi nào cần build lại.

let GLOBAL_MTIME = 0;

export class DataObject {
    constructor() {
        this._mtime = ++GLOBAL_MTIME;
        this.metadata = new Map();   // key -> value tùy ý (tên file, đơn vị, thời điểm...)
    }

    /** Đánh dấu đã thay đổi — mọi lần chỉnh dữ liệu nên gọi để pipeline rebuild. */
    modified() { this._mtime = ++GLOBAL_MTIME; return this; }
    getMTime() { return this._mtime; }

    setMetadata(k, v) { this.metadata.set(k, v); return this; }
    getMetadata(k) { return this.metadata.get(k); }

    /** [minX,minY,minZ,maxX,maxY,maxZ] — lớp con phải override. */
    getBounds() { throw new Error("DataObject.getBounds() phải được override"); }

    /** Tạo bản sao (deep) — lớp con override khi cần. */
    clone() { throw new Error("DataObject.clone() phải được override"); }
}
