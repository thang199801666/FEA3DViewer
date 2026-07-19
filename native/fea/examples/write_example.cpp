#include "fea/fea.hpp"
#include <cassert>
#include <vector>

int main(int argc, char** argv) {
  fea::Database db;
  db.title = "Reusable FEA example"; db.source_solver = "Example"; db.source_version = "1";
  fea::Material steel; steel.name = "Steel"; steel.description = "Linear elastic steel";
  fea::MaterialProperty elastic; elastic.name = "Elastic"; elastic.column_labels = {"YoungsModulus", "PoissonsRatio"};
  elastic.table = fea::make_array<double>("Elastic", fea::ScalarType::Float64, 2, {210000.0, 0.3});
  steel.properties.push_back(std::move(elastic)); db.materials.push_back(std::move(steel));
  fea::Section solidSection; solidSection.name = "SolidSection"; solidSection.category = "SOLID"; solidSection.material_name = "Steel";
  db.sections.push_back(std::move(solidSection));
  fea::Instance instance; instance.name = "PART-1-1"; instance.part_name = "PART-1";
  fea::NodeBlock nodes; nodes.name = "NODES";
  nodes.coordinates = fea::make_array<float>("coordinates", fea::ScalarType::Float32, 3, {0,0,0, 1,0,0, 0,1,0, 0,0,1});
  nodes.labels = fea::make_array<std::int32_t>("nodeLabels", fea::ScalarType::Int32, 1, {1,2,3,4});
  instance.mesh.node_blocks.push_back(nodes);
  fea::ElementBlock elements; elements.name = "SOLID-1"; elements.element_type = "C3D4"; elements.nodes_per_element = 4;
  elements.connectivity = fea::make_array<std::int32_t>("connectivity", fea::ScalarType::Int32, 1, {0,1,2,3});
  elements.labels = fea::make_array<std::int32_t>("elementLabels", fea::ScalarType::Int32, 1, {1});
  instance.mesh.element_blocks.push_back(elements);
  fea::SectionAssignment assignment; assignment.region_name = "SOLID-1"; assignment.section_name = "SolidSection";
  instance.section_assignments.push_back(std::move(assignment)); db.instances.push_back(instance);

  fea::FieldBlock uBlock; uBlock.instance_name = instance.name;
  uBlock.values = fea::make_array<float>("U", fea::ScalarType::Float32, 3, {0,0,0, .01f,0,0, 0,.01f,0, 0,0,.01f});
  uBlock.labels = nodes.labels;
  fea::FieldOutput u; u.name = "U"; u.description = "Displacement"; u.position = fea::FieldPosition::Nodal;
  u.component_labels = {"U1","U2","U3"}; u.blocks.push_back(std::move(uBlock));
  fea::Frame frame; frame.increment_number = 1; frame.value = 1.0; frame.fields.push_back(std::move(u));
  fea::FieldBlock sBlock; sBlock.instance_name = instance.name; sBlock.region_name = "SOLID-1";
  sBlock.values = fea::make_array<float>("S_Mises", fea::ScalarType::Float32, 1, {0,50,100,150});
  sBlock.labels = nodes.labels;
  fea::FieldOutput stress; stress.name = "S_Mises"; stress.description = "Example nodal von Mises stress";
  stress.position = fea::FieldPosition::Nodal; stress.component_labels = {"MISES"}; stress.valid_invariants = {"MISES"};
  stress.blocks.push_back(std::move(sBlock)); frame.fields.push_back(std::move(stress));
  fea::Step step; step.name = "Step-1"; step.procedure = "STATIC"; step.time_period = 1.0; step.frames.push_back(std::move(frame));
  fea::HistoryOutput energy; energy.name = "ALLSE"; energy.description = "Strain energy"; energy.type = "SCALAR";
  energy.frame_values = fea::make_array<double>("time", fea::ScalarType::Float64, 1, {0.0, 0.5, 1.0});
  energy.values = fea::make_array<double>("ALLSE", fea::ScalarType::Float64, 1, {0.0, 2.5, 7.0});
  fea::HistoryRegion assemblyHistory; assemblyHistory.name = "Assembly ASSEMBLY"; assemblyHistory.position = "WHOLE_MODEL";
  assemblyHistory.outputs.push_back(std::move(energy)); step.history_regions.push_back(std::move(assemblyHistory));
  db.steps.push_back(std::move(step));
  const char* output = argc > 1 ? argv[1] : "example.fea";
  fea::write_database(db, output);
  const auto copy = fea::read_database(output);
  assert(copy.instances.size() == 1 && copy.instances[0].mesh.element_blocks[0].element_type == "C3D4");
  assert(copy.steps.size() == 1 && copy.steps[0].frames[0].fields[0].name == "U");
  const auto* odbInstance = copy.instance("PART-1-1");
  const auto* odbStep = copy.step("Step-1");
  assert(odbInstance && odbInstance->mesh.node_count() == 4 && odbInstance->mesh.element_count() == 1);
  assert(copy.material("Steel") && copy.material("Steel")->property("Elastic"));
  assert(copy.section("SolidSection") && odbInstance->section_assignment("SOLID-1"));
  assert(odbStep && odbStep->frame(0)->field_output("U"));
  const auto* allse = odbStep->history_region("Assembly ASSEMBLY")->history_output("ALLSE");
  assert(allse && allse->values.tuple_count() == 3 && allse->values.data_as<double>()[2] == 7.0);
}
