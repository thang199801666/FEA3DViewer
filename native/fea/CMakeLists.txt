cmake_minimum_required(VERSION 3.16)
project(fea_format VERSION 1.0 LANGUAGES CXX)

add_library(fea_format STATIC src/fea.cpp)
target_include_directories(fea_format PUBLIC include)
target_compile_features(fea_format PUBLIC cxx_std_17)
set_target_properties(fea_format PROPERTIES OUTPUT_NAME fea)

include(GNUInstallDirs)
install(TARGETS fea_format EXPORT feaTargets ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR})
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(EXPORT feaTargets NAMESPACE fea:: DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/fea)

option(FEA_BUILD_EXAMPLES "Build FEA examples" ON)
if(FEA_BUILD_EXAMPLES)
  add_executable(fea_example examples/write_example.cpp)
  target_link_libraries(fea_example PRIVATE fea_format)
endif()
