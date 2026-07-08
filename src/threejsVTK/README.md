# threejsVTK --- Optimized Structure & High-Performance Numerical Result Visualization

The **threejsVTK** library is specifically designed to serve as a
high-performance post-processing core engine for **Finite Element
Analysis (FEA)** and **Computational Fluid Dynamics (CFD)** simulation
data on top of the **WebGL / Three.js** platform.

## 1. System Directory Structure

``` text
threejsVTK/
├── index.js
├── Core/
│   ├── DataObject.js
│   ├── DataSet.js
│   ├── FieldData.js
│   ├── CellTypes.js
│   ├── PolyData.js
│   └── UnstructuredGrid.js
├── Sources/
│   ├── Source.js
│   └── BoxSource.js, CubeSource.js, SphereSource.js
├── Filters/
│   ├── Filter.js
│   ├── ClipFilter.js
│   ├── SmoothFilter.js
│   ├── FeatureEdges.js
│   ├── ContourFilter.js
│   ├── WarpFilter.js
│   └── DataSetSurfaceFilter.js
├── Mappers/
│   ├── PolyDataMapper.js
│   ├── LookupTable.js
│   └── DataSetMapper.js
├── Actors/
│   ├── Actor.js
│   ├── ScalarBarActor.js
│   ├── VectorGlyphActor.js
│   └── OrientationTriadActor.js
├── Rendering/
│   ├── Renderer.js
│   ├── RenderWindow.js
│   ├── ColorTransferFunction.js
│   └── ContourShaderMaterial.js
├── Interaction/
│   └── RenderWindowInteractor.js
├── IO/
│   └── VTKReader.js
└── Shaders/
    ├── ContourVertex.glsl
    └── ContourFragment.glsl
```

## 2. Typical Pipeline Usage

### Standard FEA Pipeline

``` javascript
import {
  VTKReader, WarpFilter, DataSetSurfaceFilter,
  DataSetMapper, Actor,
  ColorTransferFunction, ScalarBarActor,
} from "threejsVTK";

const grid = new VTKReader().parse(vtkText);

const warped = new WarpFilter()
  .setInputData(grid)
  .setVectorArrayName("Displacement")
  .setScaleFactor(20)
  .getOutputData();

const surface = new DataSetSurfaceFilter()
  .setInputData(warped)
  .getOutputData();

const ctf = new ColorTransferFunction({
  preset: "coolToWarm"
}).setDiscrete(12);

const mapper = new DataSetMapper()
  .setInputData(surface)
  .setColorBy("VonMises", 0)
  .setLookupTable(ctf);

renderer.addActor(new Actor(mapper));
renderer.addActor(new ScalarBarActor({
  lookupTable: ctf,
  title: "von Mises"
}));
```

### CPU Isolines

``` javascript
const iso = new ContourFilter()
  .setInputData(surface)
  .generateValues(10, surface.pointData.getScalars().getRange(0))
  .getOutputData();
```

### GPU Vector Glyphs

``` javascript
const glyphs = new VectorGlyphActor(surface,{
  vectorArrayName:"Displacement",
  scaleFactor:1.5,
  maskRatio:4
});

renderer.addActor(glyphs);
```

### GPU Contours

``` javascript
const { material, attachScalar, setNumBands } =
  makeContourMaterial(ctf,{
    numBands:12,
    range,
    showIsolines:true
  });

attachScalar(geometry, scalars, range);

slider.oninput = e => setNumBands(+e.target.value);
```

## 3. Coding Style & Conventions

-   Loose Coupling Pipeline Architecture
-   DataSet inherits from `DataObject`
-   `PolyData` and `UnstructuredGrid` inherit from `DataSet`
-   All processing algorithms inherit from `Filter`
-   Modification Time (MTime) for cache invalidation
-   Fluent API (`return this`)
-   Explicit separation of `PointData`, `CellData`, and `FieldData`

### Data Types

  Type        Purpose
  ----------- -------------------------------------------------
  PointData   Nodal results (displacement, temperature, etc.)
  CellData    Element results (stress, material ID, etc.)
  FieldData   Global metadata (title, timestep, units, etc.)

## License

MIT License.
