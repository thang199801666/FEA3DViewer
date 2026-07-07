// threejsVTK — thư viện mô phỏng kiến trúc pipeline của VTK.js trên nền Three.js
//
// Pipeline chuẩn:  Source/Reader -> [Filter...] -> Mapper -> Actor -> Scene
//
//   Core/     -> Data:            PolyData, DataArray (points, cells, scalars/vectors thô)
//   Sources/  -> Sinh dữ liệu:    BoxSource (primitive có chia lưới)
//   IO/       -> Đọc file:        VTKLegacyReader (.vtk ASCII), VTPReader (.vtp)
//   Filters/  -> Algorithm:       ContourFilter, ClipFilter, SmoothFilter (PolyData -> PolyData)
//   Mappers/  -> Data->Geometry:  LookupTable, PolyDataMapper (PolyData -> THREE.BufferGeometry)
//   Actors/   -> Representation:  Actor, LineActor, ScalarBarActor (hiển thị lên scene)

export { PolyData, DataArray, AttributeSet } from "./Core/PolyData.js";
export { geometryToPolyData } from "./Core/Conversion.js";

export { BoxSource } from "./Sources/BoxSource.js";

export { VTKLegacyReader } from "./IO/VTKLegacyReader.js";
export { VTPReader } from "./IO/VTPReader.js";

export { Filter } from "./Filters/Filter.js";
export { ContourFilter } from "./Filters/ContourFilter.js";
export { ClipFilter } from "./Filters/ClipFilter.js";
export { SmoothFilter } from "./Filters/SmoothFilter.js";

export { LookupTable } from "./Mappers/LookupTable.js";
export { PolyDataMapper } from "./Mappers/PolyDataMapper.js";

export { Actor } from "./Actors/Actor.js";
export { LineActor } from "./Actors/LineActor.js";
export { ScalarBarActor } from "./Actors/ScalarBarActor.js";
export { Camera } from './Rendering/Camera.js';