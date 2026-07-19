#include "fea/fea.hpp"
#include "fea/fea_c.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <limits>
#include <stdexcept>

namespace {
constexpr std::uint8_t kMagic[8] = {'F','E','A','3','D','\r','\n',0x1a};
constexpr std::size_t kHeaderSize = 32;
constexpr std::size_t kEntrySize = 56;

void put16(std::vector<std::uint8_t>& b, std::size_t p, std::uint16_t v) { b[p]=v&255; b[p+1]=(v>>8)&255; }
void put32(std::vector<std::uint8_t>& b, std::size_t p, std::uint32_t v) { for(int i=0;i<4;i++) b[p+i]=(v>>(8*i))&255; }
void put64(std::vector<std::uint8_t>& b, std::size_t p, std::uint64_t v) { for(int i=0;i<8;i++) b[p+i]=(v>>(8*i))&255; }
std::uint16_t get16(const std::uint8_t* p) { return std::uint16_t(p[0]) | (std::uint16_t(p[1])<<8); }
std::uint32_t get32(const std::uint8_t* p) { std::uint32_t v=0; for(int i=0;i<4;i++) v|=std::uint32_t(p[i])<<(8*i); return v; }
std::uint64_t get64(const std::uint8_t* p) { std::uint64_t v=0; for(int i=0;i<8;i++) v|=std::uint64_t(p[i])<<(8*i); return v; }
std::size_t scalar_size(fea::ScalarType t) {
  switch(t) { case fea::ScalarType::Float32: case fea::ScalarType::Int32: case fea::ScalarType::UInt32: return 4;
    case fea::ScalarType::Float64: return 8; case fea::ScalarType::UInt8: return 1; }
  throw std::runtime_error("unknown scalar type");
}

struct BinOut {
  std::vector<std::uint8_t> b;
  void u8(std::uint8_t v){b.push_back(v);} void u32(std::uint32_t v){auto p=b.size();b.resize(p+4);put32(b,p,v);}
  void f64(double v){std::uint64_t n;std::memcpy(&n,&v,8);auto p=b.size();b.resize(p+8);put64(b,p,n);}
  void str(const std::string&s){if(s.size()>std::numeric_limits<std::uint32_t>::max())throw std::runtime_error("metadata string too large");u32(static_cast<std::uint32_t>(s.size()));b.insert(b.end(),s.begin(),s.end());}
  void strings(const std::vector<std::string>&v){u32(static_cast<std::uint32_t>(v.size()));for(auto&s:v)str(s);}
  void metadata(const std::vector<fea::MetadataEntry>&v){u32(static_cast<std::uint32_t>(v.size()));for(auto&e:v){str(e.key);str(e.value);}}
};
struct BinIn {
  const std::uint8_t*p;std::size_t n,pos=0;
  void need(std::size_t x){if(x>n-pos)throw std::runtime_error("truncated FEA metadata");}
  std::uint8_t u8(){need(1);return p[pos++];} std::uint32_t u32(){need(4);auto v=get32(p+pos);pos+=4;return v;}
  double f64(){need(8);auto v=get64(p+pos);pos+=8;double d;std::memcpy(&d,&v,8);return d;}
  std::string str(){auto z=u32();need(z);std::string s(reinterpret_cast<const char*>(p+pos),z);pos+=z;return s;}
  std::vector<std::string> strings(){auto z=u32();if(z>1000000)throw std::runtime_error("invalid string list");std::vector<std::string>v;v.reserve(z);while(z--)v.push_back(str());return v;}
  std::vector<fea::MetadataEntry> metadata(){auto z=u32();if(z>1000000)throw std::runtime_error("invalid metadata list");std::vector<fea::MetadataEntry>v;v.reserve(z);while(z--)v.push_back({str(),str()});return v;}
};
}

namespace fea {
namespace {
template<class T> const T* find_named(const std::vector<T>& items, const std::string& name) {
  for (const auto& item : items) if (item.name == name) return &item;
  return nullptr;
}
}
const Array* Model::find(BlockKind kind) const { for (const auto& a: arrays) if(a.kind==kind) return &a; return nullptr; }
const Array* Model::find_field(const std::string& n, Association s) const { for(const auto& a:arrays) if(a.kind==BlockKind::Field&&a.name==n&&a.association==s)return &a; return nullptr; }
const MaterialProperty* Material::property(const std::string& name) const { return find_named(properties, name); }
const NodeBlock* Mesh::node_block(const std::string& name) const { return find_named(node_blocks, name); }
const ElementBlock* Mesh::element_block(const std::string& name) const { return find_named(element_blocks, name); }
const EntitySet* Mesh::set(const std::string& name) const { return find_named(sets, name); }
const Surface* Mesh::surface(const std::string& name) const { return find_named(surfaces, name); }
std::uint64_t Mesh::node_count() const { std::uint64_t n=0; for(const auto& b:node_blocks)n+=b.labels.value_count; return n; }
std::uint64_t Mesh::element_count() const { std::uint64_t n=0; for(const auto& b:element_blocks)n+=b.labels.value_count; return n; }
const SectionAssignment* Instance::section_assignment(const std::string& region) const { for(const auto& a:section_assignments)if(a.region_name==region)return &a;return nullptr; }
std::vector<const FieldBlock*> FieldOutput::get_subset(const std::string& instance, const std::string& region) const {
  std::vector<const FieldBlock*> result; for(const auto& b:blocks) if(b.instance_name==instance && (region.empty()||b.region_name==region))result.push_back(&b); return result;
}
const FieldOutput* Frame::field_output(const std::string& name) const { return find_named(fields, name); }
const HistoryOutput* HistoryRegion::history_output(const std::string& name) const { return find_named(outputs, name); }
const Frame* Step::frame(std::size_t index) const { return index<frames.size()?&frames[index]:nullptr; }
const HistoryRegion* Step::history_region(const std::string& name) const { return find_named(history_regions, name); }
const Instance* Database::instance(const std::string& name) const { return find_named(instances, name); }
const Step* Database::step(const std::string& name) const { return find_named(steps, name); }
const Material* Database::material(const std::string& name) const { return find_named(materials, name); }
const Section* Database::section(const std::string& name) const { return find_named(sections, name); }

void Writer::add(Array a) {
  if(a.name.size()>23) throw std::invalid_argument("array name must be at most 23 UTF-8 bytes");
  if(a.components==0) throw std::invalid_argument("components must be positive");
  if(a.value_count > std::numeric_limits<std::uint32_t>::max()) throw std::invalid_argument("array is too large for FEA v1");
  if(a.bytes.size()!=a.value_count*scalar_size(a.type)) throw std::invalid_argument("array byte size does not match type/count");
  arrays_.push_back(std::move(a));
}

std::vector<std::uint8_t> Writer::write_memory() const {
  const std::uint64_t directory = kHeaderSize;
  std::uint64_t cursor = directory + arrays_.size()*kEntrySize;
  std::vector<std::uint8_t> out(static_cast<std::size_t>(cursor), 0);
  std::copy(std::begin(kMagic), std::end(kMagic), out.begin());
  put16(out,8,1); put16(out,10,0); out[12]=1; // version 1.0, little endian
  put32(out,16,static_cast<std::uint32_t>(arrays_.size())); put64(out,20,directory);
  for(std::size_t i=0;i<arrays_.size();++i) {
    const auto& a=arrays_[i]; const auto e=directory+i*kEntrySize;
    put32(out,e,static_cast<std::uint32_t>(a.kind)); out[e+4]=static_cast<std::uint8_t>(a.type);
    out[e+5]=static_cast<std::uint8_t>(a.association); out[e+6]=a.components;
    std::memcpy(out.data()+e+8,a.name.data(),a.name.size());
    put64(out,e+32,cursor); put64(out,e+40,a.bytes.size()); put64(out,e+48,a.value_count);
    out.insert(out.end(),a.bytes.begin(),a.bytes.end()); cursor+=a.bytes.size();
  }
  put32(out,28,static_cast<std::uint32_t>(out.size()));
  return out;
}

void Writer::write(const std::string& path) const { auto b=write_memory(); std::ofstream f(path,std::ios::binary); if(!f||!f.write(reinterpret_cast<const char*>(b.data()),b.size())) throw std::runtime_error("cannot write "+path); }

Model read_memory(const void* input, std::size_t size) {
  if(!input||size<kHeaderSize) throw std::runtime_error("FEA file is truncated");
  const auto* p=static_cast<const std::uint8_t*>(input);
  if(!std::equal(std::begin(kMagic),std::end(kMagic),p)) throw std::runtime_error("invalid FEA magic");
  if(get16(p+8)!=1||p[12]!=1) throw std::runtime_error("unsupported FEA version or byte order");
  const auto n=get32(p+16); const auto directory=get64(p+20);
  if(n>1000000 || directory>size || std::uint64_t(n)*kEntrySize>size-directory) throw std::runtime_error("invalid FEA directory");
  Model m; m.arrays.reserve(n);
  for(std::uint32_t i=0;i<n;++i) {
    const auto* e=p+directory+std::uint64_t(i)*kEntrySize; Array a;
    a.kind=static_cast<BlockKind>(get32(e)); a.type=static_cast<ScalarType>(e[4]); a.association=static_cast<Association>(e[5]); a.components=e[6];
    a.name.assign(reinterpret_cast<const char*>(e+8),strnlen(reinterpret_cast<const char*>(e+8),24));
    const auto offset=get64(e+32), bytes=get64(e+40); a.value_count=get64(e+48);
    if(!a.components||offset>size||bytes>size-offset||bytes!=a.value_count*scalar_size(a.type)) throw std::runtime_error("invalid FEA array entry");
    a.bytes.assign(p+offset,p+offset+bytes); m.arrays.push_back(std::move(a));
  }
  return m;
}
Model read(const std::string& path) { std::ifstream f(path,std::ios::binary|std::ios::ate); if(!f)throw std::runtime_error("cannot open "+path); auto n=f.tellg(); f.seekg(0); std::vector<std::uint8_t>b(static_cast<std::size_t>(n)); if(!f.read(reinterpret_cast<char*>(b.data()),n))throw std::runtime_error("cannot read "+path); return read_memory(b.data(),b.size()); }

std::vector<std::uint8_t> write_database_memory(const Database& db) {
  std::vector<Array> arrays; BinOut m; m.u32(4); m.str(db.title);m.str(db.description);m.str(db.source_solver);m.str(db.source_version);m.metadata(db.metadata);
  auto add=[&](Array a,BlockKind kind)->std::uint32_t{if(a.bytes.empty()&&a.value_count==0)return UINT32_MAX;a.kind=kind;auto i=static_cast<std::uint32_t>(arrays.size());a.name="a"+std::to_string(i);arrays.push_back(std::move(a));return i;};
  m.u32(static_cast<std::uint32_t>(db.materials.size()));for(const auto&material:db.materials){m.str(material.name);m.str(material.description);m.metadata(material.metadata);m.u32(static_cast<std::uint32_t>(material.properties.size()));for(const auto&p:material.properties){m.str(p.name);m.str(p.description);m.strings(p.column_labels);m.metadata(p.metadata);m.u32(add(p.table,BlockKind::Field));}}
  m.u32(static_cast<std::uint32_t>(db.sections.size()));for(const auto&section:db.sections){m.str(section.name);m.str(section.category);m.str(section.material_name);m.f64(section.thickness);m.metadata(section.metadata);}
  m.u32(static_cast<std::uint32_t>(db.instances.size()));
  for(const auto&i:db.instances){m.str(i.name);m.str(i.part_name);m.metadata(i.metadata);
    m.u32(static_cast<std::uint32_t>(i.section_assignments.size()));for(const auto&a:i.section_assignments){m.str(a.region_name);m.str(a.section_name);m.str(a.offset_type);m.f64(a.offset);m.u8(a.suppressed?1:0);m.metadata(a.metadata);}
    m.u32(static_cast<std::uint32_t>(i.mesh.node_blocks.size()));for(const auto&b:i.mesh.node_blocks){m.str(b.name);m.u32(add(b.labels,BlockKind::NodeLabels));m.u32(add(b.coordinates,BlockKind::Points));}
    m.u32(static_cast<std::uint32_t>(i.mesh.element_blocks.size()));for(const auto&b:i.mesh.element_blocks){m.str(b.name);m.str(b.element_type);m.u32(b.nodes_per_element);m.metadata(b.metadata);m.u32(add(b.labels,BlockKind::ElementLabels));m.u32(add(b.connectivity,BlockKind::Connectivity));m.u32(add(b.offsets,BlockKind::Offsets));}
    m.u32(static_cast<std::uint32_t>(i.mesh.sets.size()));for(const auto&s:i.mesh.sets){m.str(s.name);m.u8(static_cast<std::uint8_t>(s.kind));m.u32(add(s.labels,s.kind==EntityKind::Node?BlockKind::NodeLabels:BlockKind::ElementLabels));}
    m.u32(static_cast<std::uint32_t>(i.mesh.surfaces.size()));for(const auto&s:i.mesh.surfaces){m.str(s.name);m.u32(add(s.element_labels,BlockKind::ElementLabels));m.u32(add(s.face_ids,BlockKind::Field));}}
  m.u32(static_cast<std::uint32_t>(db.steps.size()));
  for(const auto&s:db.steps){m.str(s.name);m.str(s.description);m.str(s.procedure);m.u8(static_cast<std::uint8_t>(s.domain));m.f64(s.time_period);m.u32(static_cast<std::uint32_t>(s.frames.size()));
    for(const auto&f:s.frames){m.u32(f.increment_number);m.f64(f.value);m.str(f.description);m.u32(static_cast<std::uint32_t>(f.fields.size()));
      for(const auto&o:f.fields){m.str(o.name);m.str(o.description);m.u8(static_cast<std::uint8_t>(o.position));m.strings(o.component_labels);m.strings(o.valid_invariants);m.u32(static_cast<std::uint32_t>(o.blocks.size()));
        for(const auto&b:o.blocks){m.str(b.instance_name);m.str(b.region_name);m.str(b.section_point);m.u32(add(b.values,BlockKind::Field));auto labelKind=o.position==FieldPosition::Nodal?BlockKind::NodeLabels:BlockKind::ElementLabels;m.u32(add(b.labels,labelKind));m.u32(add(b.integration_points,BlockKind::Field));}}}
    m.u32(static_cast<std::uint32_t>(s.history_regions.size()));for(const auto&r:s.history_regions){m.str(r.name);m.str(r.description);m.str(r.position);m.u32(static_cast<std::uint32_t>(r.outputs.size()));for(const auto&o:r.outputs){m.str(o.name);m.str(o.description);m.str(o.type);m.strings(o.component_labels);m.u32(add(o.frame_values,BlockKind::Field));m.u32(add(o.values,BlockKind::Field));}}}
  Array metadata{"database",BlockKind::Metadata,ScalarType::UInt8,Association::None,1};metadata.value_count=m.b.size();metadata.bytes=std::move(m.b);arrays.push_back(std::move(metadata));
  Writer w;for(auto&a:arrays)w.add(std::move(a));return w.write_memory();
}
void write_database(const Database& db,const std::string& path){auto b=write_database_memory(db);std::ofstream f(path,std::ios::binary);if(!f||!f.write(reinterpret_cast<const char*>(b.data()),b.size()))throw std::runtime_error("cannot write "+path);}

Database read_database_memory(const void* data,std::size_t size){auto archive=read_memory(data,size);const Array*meta=archive.find(BlockKind::Metadata);if(!meta)throw std::runtime_error("FEA database metadata is missing");BinIn m{meta->bytes.data(),meta->bytes.size()};const auto schema=m.u32();if(schema<2||schema>4)throw std::runtime_error("unsupported FEA database schema");
  auto get=[&](std::uint32_t i)->Array{if(i==UINT32_MAX)return {};if(i>=archive.arrays.size()||&archive.arrays[i]==meta)throw std::runtime_error("invalid metadata array reference");return archive.arrays[i];};
  Database db;db.title=m.str();db.description=m.str();db.source_solver=m.str();db.source_version=m.str();db.metadata=m.metadata();if(schema>=4){auto nm=m.u32();while(nm--){Material material;material.name=m.str();material.description=m.str();material.metadata=m.metadata();auto np=m.u32();while(np--){MaterialProperty p;p.name=m.str();p.description=m.str();p.column_labels=m.strings();p.metadata=m.metadata();p.table=get(m.u32());material.properties.push_back(std::move(p));}db.materials.push_back(std::move(material));}auto nc=m.u32();while(nc--){Section section;section.name=m.str();section.category=m.str();section.material_name=m.str();section.thickness=m.f64();section.metadata=m.metadata();db.sections.push_back(std::move(section));}}auto ni=m.u32();if(ni>1000000)throw std::runtime_error("invalid instance count");
  while(ni--){Instance i;i.name=m.str();i.part_name=m.str();i.metadata=m.metadata();if(schema>=4){auto na=m.u32();while(na--){SectionAssignment a;a.region_name=m.str();a.section_name=m.str();a.offset_type=m.str();a.offset=m.f64();a.suppressed=m.u8()!=0;a.metadata=m.metadata();i.section_assignments.push_back(std::move(a));}}auto nn=m.u32();while(nn--){NodeBlock b;b.name=m.str();b.labels=get(m.u32());b.coordinates=get(m.u32());i.mesh.node_blocks.push_back(std::move(b));}auto ne=m.u32();while(ne--){ElementBlock b;b.name=m.str();b.element_type=m.str();b.nodes_per_element=m.u32();b.metadata=m.metadata();b.labels=get(m.u32());b.connectivity=get(m.u32());b.offsets=get(m.u32());i.mesh.element_blocks.push_back(std::move(b));}auto nz=m.u32();while(nz--){EntitySet s;s.name=m.str();s.kind=static_cast<EntityKind>(m.u8());s.labels=get(m.u32());i.mesh.sets.push_back(std::move(s));}auto nv=m.u32();while(nv--){Surface s;s.name=m.str();s.element_labels=get(m.u32());s.face_ids=get(m.u32());i.mesh.surfaces.push_back(std::move(s));}db.instances.push_back(std::move(i));}
  auto ns=m.u32();if(ns>1000000)throw std::runtime_error("invalid step count");while(ns--){Step s;s.name=m.str();s.description=m.str();s.procedure=m.str();s.domain=static_cast<FrameDomain>(m.u8());s.time_period=m.f64();auto nf=m.u32();
    while(nf--){Frame f;f.increment_number=m.u32();f.value=m.f64();f.description=m.str();auto no=m.u32();while(no--){FieldOutput o;o.name=m.str();o.description=m.str();o.position=static_cast<FieldPosition>(m.u8());o.component_labels=m.strings();o.valid_invariants=m.strings();auto nb=m.u32();while(nb--){FieldBlock b;b.instance_name=m.str();b.region_name=m.str();b.section_point=m.str();b.values=get(m.u32());b.labels=get(m.u32());b.integration_points=get(m.u32());o.blocks.push_back(std::move(b));}f.fields.push_back(std::move(o));}s.frames.push_back(std::move(f));}if(schema>=3){auto nr=m.u32();while(nr--){HistoryRegion r;r.name=m.str();r.description=m.str();r.position=m.str();auto no=m.u32();while(no--){HistoryOutput o;o.name=m.str();o.description=m.str();o.type=m.str();o.component_labels=m.strings();o.frame_values=get(m.u32());o.values=get(m.u32());r.outputs.push_back(std::move(o));}s.history_regions.push_back(std::move(r));}}db.steps.push_back(std::move(s));}
  if(m.pos!=m.n)throw std::runtime_error("unexpected trailing FEA metadata");return db;}
Database read_database(const std::string&path){std::ifstream f(path,std::ios::binary|std::ios::ate);if(!f)throw std::runtime_error("cannot open "+path);auto n=f.tellg();f.seekg(0);std::vector<std::uint8_t>b(static_cast<std::size_t>(n));if(!f.read(reinterpret_cast<char*>(b.data()),n))throw std::runtime_error("cannot read "+path);return read_database_memory(b.data(),b.size());}
}

namespace { fea::Model g_model; fea::Writer g_writer; std::vector<std::uint8_t> g_write_output; std::string g_error; const fea::Array* at(uint32_t i){return i<g_model.arrays.size()?&g_model.arrays[i]:nullptr;} }
extern "C" {
int32_t fea_open(const uint8_t* d,uint32_t n){try{g_model=fea::read_memory(d,n);g_error.clear();return 1;}catch(const std::exception&e){g_model={};g_error=e.what();return 0;}}
void fea_close(){g_model={};g_error.clear();} const char* fea_last_error(){return g_error.c_str();}
uint32_t fea_array_count(){return static_cast<uint32_t>(g_model.arrays.size());}
uint32_t fea_array_kind(uint32_t i){auto*a=at(i);return a?static_cast<uint32_t>(a->kind):0;}
uint32_t fea_array_type(uint32_t i){auto*a=at(i);return a?static_cast<uint32_t>(a->type):0;}
uint32_t fea_array_association(uint32_t i){auto*a=at(i);return a?static_cast<uint32_t>(a->association):0;}
uint32_t fea_array_components(uint32_t i){auto*a=at(i);return a?a->components:0;}
uint32_t fea_array_value_count(uint32_t i){auto*a=at(i);return a?static_cast<uint32_t>(a->value_count):0;}
const char* fea_array_name(uint32_t i){auto*a=at(i);return a?a->name.c_str():"";}
const uint8_t* fea_array_data(uint32_t i){auto*a=at(i);return a&&!a->bytes.empty()?a->bytes.data():nullptr;}
uint32_t fea_array_byte_length(uint32_t i){auto*a=at(i);return a?static_cast<uint32_t>(a->bytes.size()):0;}
void fea_write_begin(){g_writer=fea::Writer{};g_write_output.clear();g_error.clear();}
int32_t fea_write_add(const char*name,uint32_t kind,uint32_t type,uint32_t association,uint32_t components,const uint8_t*data,uint32_t byteLength,uint32_t valueCount){try{fea::Array a{name?name:"",static_cast<fea::BlockKind>(kind),static_cast<fea::ScalarType>(type),static_cast<fea::Association>(association),static_cast<uint8_t>(components)};if(byteLength&&!data)throw std::runtime_error("null array data");if(byteLength)a.bytes.assign(data,data+byteLength);a.value_count=valueCount;g_writer.add(std::move(a));return 1;}catch(const std::exception&e){g_error=e.what();return 0;}}
int32_t fea_write_finish(){try{g_write_output=g_writer.write_memory();return 1;}catch(const std::exception&e){g_error=e.what();g_write_output.clear();return 0;}}
const uint8_t* fea_write_data(){return g_write_output.empty()?nullptr:g_write_output.data();}
uint32_t fea_write_size(){return static_cast<uint32_t>(g_write_output.size());}
}
