// index.js - the single public API surface of threejsVTK.
// Deep imports (threejs-vtk/src/filters/...) are blocked by the package exports map.

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
export { HexBoltSource } from "./sources/HexBoltSource.js";
export { PerforatedPlateSource } from "./sources/PerforatedPlateSource.js";
export { ExtrudedProfileSource } from "./sources/ExtrudedProfileSource.js";

// ── io ──────────────────────────────────────────────────────────────────────
export { VTKReader } from "./io/VTKReader.js";
export { FEAReader } from "./io/FEAReader.js";
export { FEAWriter } from "./io/FEAWriter.js";
export { VTKWorkerSession } from "./io/VTKWorkerSession.js";
export { getPerformanceEntries, clearPerformanceEntries } from "./performance/telemetry.js";
export { getMemoryBudget, assessVTKFileMemory } from "./performance/memoryBudget.js";
export { VTKLegacyReader } from "./io/VTKLegacyReader.js";
export { VTPReader } from "./io/VTPReader.js";
export { DataArrayCodec } from "./io/dataArrayCodec.js";

// ── geometry (raw BufferGeometry helpers) ───────────────────────────────────
export { weldVertices } from "./geometry/weld.js";
export { extractByTopology } from "./geometry/surfaceTopology.js";
export { extractByVisibility } from "./geometry/surfaceVisibility.js";
export { FeatureEdges } from "./geometry/featureEdges.js";
export { computeSceneBounds, SectionPlaneHelperActor } from "./utils/scenePrimitives.js";

// ── filters (PolyData -> PolyData) ──────────────────────────────────────────
export { Filter } from "./filters/Filter.js";
export { SurfaceFilter, SURFACE_STRATEGY } from "./filters/SurfaceFilter.js";
export { DataSetSurfaceFilter } from "./filters/DataSetSurfaceFilter.js";
export { initializeSurfaceWasm, getSurfaceWasmStatus, getWasmCapabilities } from "./wasm/surfaceExtractorWasm.js";
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
export { LargeModelActor } from "./actors/LargeModelActor.js";
export { LineActor } from "./actors/LineActor.js";
export { SectionActor } from "./actors/SectionActor.js";
export { VectorGlyphActor } from "./actors/VectorGlyphActor.js";
export { LoadArrowActor } from "./actors/LoadArrowActor.js";
export { MomentArrowActor } from "./actors/MomentArrowActor.js";
export { GridActor } from "./actors/GridActor.js";

// ── lights ─────────────────────────────────────────────────────────────────
export { AmbientLightActor, DirectionalLightActor } from "./lights/LightActors.js";

// ── widgets ─────────────────────────────────────────────────────────────────
export { ScalarBarActor } from "./widgets/ScalarBarActor.js";
export { OrientationTriadActor } from "./widgets/OrientationTriadActor.js";
// The file was renamed, but the class name is kept for compatibility.
// CameraNavigationActor is the preferred export name.
export { CameraNavigationActor, CameraNavigationActor as NavigationCube } from "./widgets/NavigationCube.js";
export { MeasurementRulerActor, MeasurementRulerActor as MeasurementRuler } from "./widgets/MeasurementRuler.js";
export { MeasurementTool, MEASUREMENT_MODE } from "./widgets/MeasurementTool.js";

// ── rendering ───────────────────────────────────────────────────────────────
export { RenderWindow } from "./rendering/RenderWindow.js";
export { Renderer } from "./rendering/Renderer.js";
export { RenderingBackend } from "./rendering/RenderingBackend.js";
export { partitionGeometry, buildLODGeometries, createLargeModelLOD } from "./rendering/LargeModelLOD.js";
export { makeContourMaterial } from "./rendering/materials/ContourShaderMaterial.js";
export { makeHatchMaterial } from "./rendering/materials/HatchMaterial.js";

// ── camera ──────────────────────────────────────────────────────────────────
export { Camera } from "./camera/Camera.js";
export { applyVTKCameraApi, VTK_CAMERA_API } from "./camera/vtkCameraApi.js";
export { CameraState } from "./camera/CameraState.js";
export { CameraMath } from "./camera/CameraMath.js";
export { CameraAnimation } from "./camera/CameraAnimation.js";
export { CameraClipping } from "./camera/CameraClipping.js";

// ── interaction ─────────────────────────────────────────────────────────────
export { NAV_STYLE, INTERACTION_ACTION, INTERACTION_MODE, NAV_STATE, RUBBER_BAND_MODE } from "./interaction/constants.js";
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
export { ActorTopology } from "./interaction/picking/ActorTopology.js";

export { ActorHighlighter, DEFAULT_HIGHLIGHT_STYLE } from "./interaction/highlight/ActorHighlighter.js";
export { SelectionHighlighter } from "./interaction/highlight/SelectionHighlighter.js";
