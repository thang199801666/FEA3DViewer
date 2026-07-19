#pragma once

#include <cstdint>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

namespace fea {

enum class ScalarType : std::uint8_t { Float32 = 1, Float64 = 2, Int32 = 3, UInt32 = 4, UInt8 = 5 };
enum class Association : std::uint8_t { None = 0, Point = 1, Cell = 2 };
enum class BlockKind : std::uint32_t {
  Points = 1, Connectivity = 2, Offsets = 3, CellTypes = 4, Field = 100,
  NodeLabels = 101, ElementLabels = 102, ElementTypeIds = 103, Metadata = 1000
};

enum class FieldPosition : std::uint8_t { Nodal = 1, ElementNodal = 2, IntegrationPoint = 3, Centroid = 4, ElementFace = 5 };
enum class FrameDomain : std::uint8_t { Time = 1, Frequency = 2, Modal = 3, LoadCase = 4 };
enum class EntityKind : std::uint8_t { Node = 1, Element = 2 };

struct Array {
  std::string name;
  BlockKind kind = BlockKind::Field;
  ScalarType type = ScalarType::Float32;
  Association association = Association::None;
  std::uint8_t components = 1;
  std::vector<std::uint8_t> bytes;
  std::uint64_t value_count = 0;

  std::size_t tuple_count() const { return components ? static_cast<std::size_t>(value_count / components) : 0; }
  bool empty() const { return value_count == 0; }
  template<class T> const T* data_as() const {
    const bool valid = (std::is_same<T, float>::value && type == ScalarType::Float32) ||
      (std::is_same<T, double>::value && type == ScalarType::Float64) ||
      (std::is_same<T, std::int32_t>::value && type == ScalarType::Int32) ||
      (std::is_same<T, std::uint32_t>::value && type == ScalarType::UInt32) ||
      (std::is_same<T, std::uint8_t>::value && type == ScalarType::UInt8);
    if (!valid) throw std::runtime_error("FEA array scalar type mismatch");
    return bytes.empty() ? nullptr : reinterpret_cast<const T*>(bytes.data());
  }
};

template<class T> Array make_array(std::string name, ScalarType type, std::uint8_t components,
                                   const std::vector<T>& values, Association association = Association::None) {
  Array a{std::move(name), BlockKind::Field, type, association, components};
  a.value_count = values.size();
  const auto* p = reinterpret_cast<const std::uint8_t*>(values.data());
  a.bytes.assign(p, p + values.size() * sizeof(T));
  return a;
}

struct Model {
  std::vector<Array> arrays;

  const Array* find(BlockKind kind) const;
  const Array* find_field(const std::string& name, Association association) const;
};

struct MetadataEntry { std::string key; std::string value; };

struct MaterialProperty {
  std::string name;        // Abaqus-style name: Elastic, Density, Plastic, ...
  std::string description;
  std::vector<std::string> column_labels;
  Array table;             // Rows of numeric property data; components = column count.
  std::vector<MetadataEntry> metadata;
};

struct Material {
  std::string name;
  std::string description;
  std::vector<MaterialProperty> properties;
  std::vector<MetadataEntry> metadata;

  const MaterialProperty* property(const std::string& name) const;
};

struct Section {
  std::string name;
  std::string category;    // SOLID, SHELL, BEAM, COHESIVE, solver-specific, ...
  std::string material_name;
  double thickness = 0.0;
  std::vector<MetadataEntry> metadata;
};

struct SectionAssignment {
  std::string region_name; // Element set or element-block name in this instance.
  std::string section_name;
  std::string offset_type;
  double offset = 0.0;
  bool suppressed = false;
  std::vector<MetadataEntry> metadata;
};

struct NodeBlock {
  std::string name;
  Array labels;            // Original solver node labels.
  Array coordinates;       // xyz tuples in the same order as labels.
};

struct ElementBlock {
  std::string name;        // e.g. PART-1-1/C3D8R/0
  std::string element_type;// Solver-neutral topology name, e.g. HEX8 or Abaqus C3D8R.
  std::uint32_t nodes_per_element = 0;
  Array labels;            // Original solver element labels.
  Array connectivity;      // zero-based indices into the instance's concatenated node blocks.
  Array offsets;           // Optional for variable topology; otherwise derived from nodes_per_element.
  std::vector<MetadataEntry> metadata;
};

struct EntitySet {
  std::string name;
  EntityKind kind = EntityKind::Node;
  Array labels;
};

struct Surface {
  std::string name;
  Array element_labels;
  Array face_ids;          // Solver face identifiers, one per element label.
};

struct Mesh {
  std::vector<NodeBlock> node_blocks;
  std::vector<ElementBlock> element_blocks;
  std::vector<EntitySet> sets;
  std::vector<Surface> surfaces;

  const NodeBlock* node_block(const std::string& name) const;
  const ElementBlock* element_block(const std::string& name) const;
  const EntitySet* set(const std::string& name) const;
  const Surface* surface(const std::string& name) const;
  std::uint64_t node_count() const;
  std::uint64_t element_count() const;
};

struct Instance {
  std::string name;
  std::string part_name;
  Mesh mesh;
  std::vector<MetadataEntry> metadata;
  std::vector<SectionAssignment> section_assignments;

  const SectionAssignment* section_assignment(const std::string& region_name) const;
};

struct FieldBlock {
  std::string instance_name;
  std::string region_name; // Element block, set, surface, or empty for the whole instance.
  std::string section_point;
  Array values;
  Array labels;             // node/element labels matching value tuples.
  Array integration_points; // optional uint8/uint32 integration-point number.
};

struct FieldOutput {
  std::string name;
  std::string description;
  FieldPosition position = FieldPosition::Nodal;
  std::vector<std::string> component_labels;
  std::vector<std::string> valid_invariants;
  std::vector<FieldBlock> blocks;

  std::vector<const FieldBlock*> get_subset(const std::string& instance_name,
                                            const std::string& region_name = {}) const;
};

struct Frame {
  std::uint32_t increment_number = 0;
  double value = 0.0;
  std::string description;
  std::vector<FieldOutput> fields;

  const FieldOutput* field_output(const std::string& name) const;
};

struct HistoryOutput {
  std::string name;        // e.g. U2, RF2, ALLSE
  std::string description;
  std::string type;        // SCALAR, VECTOR, TENSOR, or solver-specific type
  std::vector<std::string> component_labels;
  Array frame_values;      // Usually Float64 time/frequency/modal coordinates.
  Array values;            // One tuple per frame value.
};

struct HistoryRegion {
  std::string name;        // e.g. Node PART-1-1.10 or Assembly ASSEMBLY
  std::string description;
  std::string position;
  std::vector<HistoryOutput> outputs;

  const HistoryOutput* history_output(const std::string& name) const;
};

struct Step {
  std::string name;
  std::string description;
  std::string procedure;
  FrameDomain domain = FrameDomain::Time;
  double time_period = 0.0;
  std::vector<Frame> frames;
  std::vector<HistoryRegion> history_regions;

  const Frame* frame(std::size_t index) const;
  const HistoryRegion* history_region(const std::string& name) const;
};

struct Database {
  std::string title;
  std::string description;
  std::string source_solver;
  std::string source_version;
  std::vector<MetadataEntry> metadata;
  std::vector<Material> materials;
  std::vector<Section> sections;
  std::vector<Instance> instances;
  std::vector<Step> steps;

  const Instance* instance(const std::string& name) const;
  const Step* step(const std::string& name) const;
  const Material* material(const std::string& name) const;
  const Section* section(const std::string& name) const;
};

class Writer {
public:
  void add(Array array);
  template<class T> void add_array(std::string name, BlockKind kind, ScalarType type,
                                   Association association, std::uint8_t components,
                                   const std::vector<T>& values) {
    Array a{std::move(name), kind, type, association, components};
    a.value_count = values.size();
    const auto* p = reinterpret_cast<const std::uint8_t*>(values.data());
    a.bytes.assign(p, p + values.size() * sizeof(T));
    add(std::move(a));
  }
  void write(const std::string& path) const;
  std::vector<std::uint8_t> write_memory() const;
private:
  std::vector<Array> arrays_;
};

Model read(const std::string& path);
Model read_memory(const void* data, std::size_t size);

/* High-level ODB-like object model. Large arrays remain separate archive blocks. */
void write_database(const Database& database, const std::string& path);
std::vector<std::uint8_t> write_database_memory(const Database& database);
Database read_database(const std::string& path);
Database read_database_memory(const void* data, std::size_t size);

} // namespace fea
