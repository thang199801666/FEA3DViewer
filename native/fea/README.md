# libfea

Standalone C++17 library using Exodus-style mesh blocks and an ODB-like, solver-neutral results hierarchy. It has no React, VTK, Abaqus, operating-system, or third-party runtime dependency.

Use the high-level `fea::Database` API for applications. `fea::Model`, `fea::Array`, and `fea::Writer` are the lower-level archive API used by the codec and WASM boundary.

```cpp
#include <fea/fea.hpp>

fea::Database db = fea::read_database("result.fea");
const auto& lastFrame = db.steps.back().frames.back();
fea::write_database(db, "copy.fea");
```

## ODB-style access

Lookups return stable pointers owned by the loaded `Database` and do not copy numeric payloads:

```cpp
fea::Database odb = fea::read_database("result.fea");

const fea::Instance* instance = odb.instance("PART-1-1");
const fea::ElementBlock* solids = instance->mesh.element_block("SOLID-1");
const std::int32_t* connectivity = solids->connectivity.data_as<std::int32_t>();

const fea::Step* step = odb.step("Step-1");
const fea::Frame* frame = step->frame(step->frames.size() - 1);
const fea::FieldOutput* displacement = frame->field_output("U");
auto blocks = displacement->get_subset("PART-1-1");
const float* u = blocks.front()->values.data_as<float>();

const fea::HistoryRegion* assembly = step->history_region("Assembly ASSEMBLY");
const fea::HistoryOutput* energy = assembly->history_output("ALLSE");
const double* time = energy->frame_values.data_as<double>();
const double* allse = energy->values.data_as<double>();
```

Material and section assignment navigation follows the ODB relationship:

```cpp
const fea::SectionAssignment* assignment =
    instance->section_assignment("SOLID-1");
const fea::Section* section = odb.section(assignment->section_name);
const fea::Material* material = odb.material(section->material_name);
const fea::MaterialProperty* elastic = material->property("Elastic");

const double* elasticTable = elastic->table.data_as<double>();
// Rows use elastic->column_labels, e.g. YoungsModulus, PoissonsRatio.
```

Material properties use generic typed tables, so an Abaqus adapter can preserve
`Elastic`, `Density`, `Plastic`, thermal properties, and solver-specific property
families without adding a new binary format field for every Abaqus material model.

Available navigation mirrors the useful read-only portion of the Abaqus ODB hierarchy:
`Database::instance/step/material/section`, `Mesh::node_block/element_block/set/surface`,
`Step::frame/history_region`, `Frame::field_output`,
`FieldOutput::get_subset`, and `HistoryRegion::history_output`.

An Abaqus converter is a different target and owns the proprietary dependency:

```cmake
add_executable(odb2fea src/main.cpp src/abaqus_odb_adapter.cpp)
target_link_libraries(odb2fea PRIVATE fea::fea_format ${ABAQUS_ODB_LIBRARIES})
target_include_directories(odb2fea PRIVATE ${ABAQUS_INCLUDE_DIRS})
```

The exact Abaqus libraries, compiler toolset, and API calls depend on the Abaqus release. Compile `odb2fea` with the compiler version supported by that release. The resulting `.fea` files do not require Abaqus to open.

See [FORMAT.md](FORMAT.md) and [examples/write_example.cpp](examples/write_example.cpp).
