// index.js — API công khai DUY NHẤT của threejsVTK.
// Deep import (threejs-vtk/src/filters/...) bị chặn qua "exports" trong package.json.

// ── core ────────────────────────────────────────────────────────────────────
export { DataObject } from "./core/DataObject.js";
export { DataSet } from "./core/DataSet.js";
export { PolyData, DataArray, PointData, CellData } from "./core/PolyData.js";
export { UnstructuredGrid } from "./core/UnstructuredGrid.js";
export { FieldData } from "./core/FieldData.js";
export * from "./core/CellTypes.js";
export {
    toSurfacePolyData, polyDataToGeometry, polyDataFromExtracted, geometryToPolyData,
} from "./core/conversion.js";

// ── sources ─────────────────────────────────────────────────────────────────
export { BoxSource } from "./sources/BoxSource.js";

// ── io ──────────────────────────────────────────────────────────────────────
export { VTKReader } from "./io/VTKReader.js";
export { VTKLegacyReader } from "./io/VTKLegacyReader.js";
export { VTPReader } from "./io/VTPReader.js";
export { DataArrayCodec } from "./io/dataArrayCodec.js";

// ── geometry (thuần BufferGeometry) ─────────────────────────────────────────
export { weldVertices } from "./geometry/weld.js";
export { extractByTopology } from "./geometry/surfaceTopology.js";
export { extractByVisibility } from "./geometry/surfaceVisibility.js";
export { FeatureEdges } from "./geometry/featureEdges.js";

// ── filters (PolyData -> PolyData) ──────────────────────────────────────────
export { Filter } from "./filters/Filter.js";
export { SurfaceFilter, SURFACE_STRATEGY } from "./filters/SurfaceFilter.js";
export { DataSetSurfaceFilter } from "./filters/DataSetSurfaceFilter.js";
export { ContourFilter } from "./filters/ContourFilter.js";
export { ClipFilter } from "./filters/ClipFilter.js";
export { ClipClosedSurfaceFilter } from "./filters/ClipClosedSurfaceFilter.js";
export { CutterFilter } from "./filters/CutterFilter.js";
export { SmoothFilter } from "./filters/SmoothFilter.js";
export { WarpFilter } from "./filters/WarpFilter.js";

// ── color ───────────────────────────────────────────────────────────────────
export { LookupTable } from "./color/LookupTable.js";
export { ColorTransferFunction, COLORMAP_PRESETS } from "./color/ColorTransferFunction.js";

// ── mappers ─────────────────────────────────────────────────────────────────
export { PolyDataMapper } from "./mappers/PolyDataMapper.js";
export { DataSetMapper } from "./mappers/DataSetMapper.js";

// ── actors ──────────────────────────────────────────────────────────────────
export { Actor } from "./actors/Actor.js";
export { LineActor } from "./actors/LineActor.js";
export { SectionActor } from "./actors/SectionActor.js";
export { VectorGlyphActor } from "./actors/VectorGlyphActor.js";

// ── widgets ─────────────────────────────────────────────────────────────────
export { ScalarBarActor } from "./widgets/ScalarBarActor.js";
export { OrientationTriadActor } from "./widgets/OrientationTriadActor.js";
// File đã đổi tên; tên class giữ nguyên để không phá code cũ. Alias là tên nên dùng.
export { CameraNavigationActor, CameraNavigationActor as NavigationCube } from "./widgets/NavigationCube.js";
export { MeasurementRulerActor, MeasurementRulerActor as MeasurementRuler } from "./widgets/MeasurementRuler.js";

// ── rendering ───────────────────────────────────────────────────────────────
export { RenderWindow } from "./rendering/RenderWindow.js";
export { Renderer } from "./rendering/Renderer.js";
export { makeContourMaterial } from "./rendering/materials/ContourShaderMaterial.js";
export { makeHatchMaterial } from "./rendering/materials/HatchMaterial.js";

// ── camera ──────────────────────────────────────────────────────────────────
// LƯU Ý: camera/Camera.js hiện là PLACEHOLDER. Chép Rendering/Camera.js của bạn đè lên.
export { Camera } from "./camera/Camera.js";
export { applyVTKCameraApi, VTK_CAMERA_API } from "./camera/vtkCameraApi.js";
export { CameraState } from "./camera/CameraState.js";
export { CameraMath } from "./camera/CameraMath.js";
export { CameraAnimation } from "./camera/CameraAnimation.js";
export { CameraClipping } from "./camera/CameraClipping.js";

// ── interaction ─────────────────────────────────────────────────────────────
export { NAV_STYLE, INTERACTION_ACTION, NAV_STATE, RUBBER_BAND_MODE } from "./interaction/constants.js";
export { RenderWindowInteractor } from "./interaction/RenderWindowInteractor.js";
export { InteractorStyle } from "./interaction/InteractorStyle.js";
export { InteractorStyleOrbit } from "./interaction/InteractorStyleOrbit.js";
export { InteractorStyleCAD } from "./interaction/InteractorStyleCAD.js";
export { InteractorStyleTrackballCamera } from "./interaction/InteractorStyleTrackballCamera.js";
export { InputStyleHandler } from "./interaction/InputStyleHandler.js";

export { Picker } from "./interaction/picking/Picker.js";
export { SubPicker } from "./interaction/picking/SubPicker.js";
export { PickingController } from "./interaction/picking/PickingController.js";
export { PickMode } from "./interaction/picking/PickMode.js";
// LƯU Ý: ActorTopology hiện là PLACEHOLDER (file gốc 0 byte).
export { ActorTopology } from "./interaction/picking/ActorTopology.js";

export { ActorHighlighter, DEFAULT_HIGHLIGHT_STYLE } from "./interaction/highlight/ActorHighlighter.js";
export { SelectionHighlighter } from "./interaction/highlight/SelectionHighlighter.js";
