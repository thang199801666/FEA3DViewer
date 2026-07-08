// threejsVTK/index.js — điểm export hợp nhất của toàn thư viện.
// import { Renderer, VTKReader, WarpFilter, DataSetMapper, Actor, ColorTransferFunction } from "threejsVTK";

// ---- Core ----
export { DataObject } from "./Core/DataObject.js";
export { DataSet } from "./Core/DataSet.js";
export { DataArray, FieldData, PointData, CellData, AttributeSet } from "./Core/FieldData.js";
export { PolyData } from "./Core/PolyData.js";
export { UnstructuredGrid } from "./Core/UnstructuredGrid.js";
export {
    CellType, CELL_FACES, CELL_NUM_POINTS, CELL_NUM_CORNERS, isSolidCell, is2DCell,
} from "./Core/CellTypes.js";
export { geometryToPolyData } from "./Core/Conversion.js";

// ---- Sources ----
export { Source } from "./Sources/Source.js";
export { BoxSource } from "./Sources/BoxSource.js";
export { CubeSource } from "./Sources/CubeSource.js";
export { SphereSource } from "./Sources/SphereSource.js";

// ---- Filters ----
export { Filter } from "./Filters/Filter.js";
export { ClipFilter } from "./Filters/ClipFilter.js";
export { ContourFilter } from "./Filters/ContourFilter.js";
export { SmoothFilter } from "./Filters/SmoothFilter.js";
export { FeatureEdges } from "./Filters/FeatureEdges.js";
export { WarpFilter } from "./Filters/WarpFilter.js";
export { DataSetSurfaceFilter } from "./Filters/DataSetSurfaceFilter.js";
export { CutterFilter } from "./Filters/CutterFilter.js";
export { ClipClosedSurfaceFilter } from "./Filters/ClipClosedSurfaceFilter.js";

// ---- Mappers ----
export { PolyDataMapper } from "./Mappers/PolyDataMapper.js";
export { DataSetMapper } from "./Mappers/DataSetMapper.js";
export { LookupTable } from "./Mappers/LookupTable.js";

// ---- Actors ----
export { Actor, DisplayMode } from "./Actors/Actor.js";
export { LineActor } from "./Actors/LineActor.js";
export { ScalarBarActor } from "./Actors/ScalarBarActor.js";
export { VectorGlyphActor } from "./Actors/VectorGlyphActor.js";
export { SectionActor } from "./Actors/SectionActor.js";
export { OrientationTriadActor } from "./Actors/OrientationTriadActor.js";
export { CameraNavigationActor } from "./Actors/CameraNavigationActor.js";
export { MeasurementRulerActor } from "./Actors/MeasurementRulerActor.js";
export { ActorHighlighter, DEFAULT_HIGHLIGHT_STYLE } from "./Actors/ActorHighlighter.js";

// ---- Rendering ----
export { Renderer } from "./Rendering/Renderer.js";
export { RenderWindow } from "./Rendering/RenderWindow.js";
export { Camera } from "./Rendering/Camera.js";
export { VTKCamera } from "./Rendering/VTKCamera.js";
export { ColorTransferFunction, COLORMAP_PRESETS } from "./Rendering/ColorTransferFunction.js";
export { makeContourMaterial } from "./Rendering/ContourShaderMaterial.js";
export { makeHatchMaterial } from "./Rendering/HatchMaterial.js";

// ---- Interaction ----
export { RenderWindowInteractor } from "./Interaction/RenderWindowInteractor.js";
export { InteractorStyle } from "./Interaction/InteractorStyle.js";
export { InteractorStyleOrbit, RUBBER_BAND_MODE } from "./Interaction/InteractorStyleOrbit.js";
export { InteractorStyleCAD } from "./Interaction/InteractorStyleCAD.js";
export { InteractorStyleTrackballCamera } from "./Interaction/InteractorStyleTrackballCamera.js";
export { InputStyleHandler, NAV_STYLE, INTERACTION_ACTION } from "./Interaction/InputStyleHandler.js";
export { Picker } from "./Interaction/Picker.js";

// ---- IO ----
export { VTKReader } from "./IO/VTKReader.js";
export { VTKLegacyReader } from "./IO/VTKLegacyReader.js";
export { VTPReader } from "./IO/VTPReader.js";
