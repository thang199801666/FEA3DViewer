// Picking/Picker.js — shim tương thích ngược.
// Picker đã chuyển sang Interaction/. File này chỉ re-export để code app cũ
// (import từ "threejsVTK/Picking/Picker.js") vẫn chạy. Có thể xoá sau khi bạn
// đổi các import sang "../threejsVTK/Interaction/Picker.js".
export { Picker } from "../Interaction/Picker.js";
