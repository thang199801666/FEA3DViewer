// Camera/Camera.js — shim tương thích ngược cho facade Camera.
// Vị trí thật hiện nay: Rendering/Camera.js. Re-export để import cũ
// ("threejsVTK/Camera/Camera.js") vẫn chạy.
export { Camera, default } from "../Rendering/Camera.js";
