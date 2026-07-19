$ErrorActionPreference = "Stop"
if (-not $env:EMSDK) { throw "Activate Emscripten first (EMSDK is not set)." }

$emcc = Join-Path $env:EMSDK "upstream\emscripten\em++.exe"
$source = Join-Path $PSScriptRoot "src\fea.cpp"
$outputDir = Join-Path $PSScriptRoot "..\..\public\wasm"
$output = Join-Path $outputDir "fea_reader.wasm"
New-Item -ItemType Directory -Force $outputDir | Out-Null

& $emcc $source "-I$(Join-Path $PSScriptRoot 'include')" -std=c++17 -O3 -fwasm-exceptions `
  -s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS="['_malloc','_free','_fea_open','_fea_close','_fea_last_error','_fea_array_count','_fea_array_kind','_fea_array_type','_fea_array_association','_fea_array_components','_fea_array_value_count','_fea_array_name','_fea_array_data','_fea_array_byte_length','_fea_write_begin','_fea_write_add','_fea_write_finish','_fea_write_data','_fea_write_size']" `
  -s INITIAL_MEMORY=16777216 -s ALLOW_MEMORY_GROWTH=1 "-Wl,--no-entry" -o $output
if ($LASTEXITCODE -ne 0) { throw "WASM build failed with exit code $LASTEXITCODE" }
Write-Host "Built $output"
