$ErrorActionPreference = "Stop"

$nativeDir = $PSScriptRoot
$outputDir = Join-Path $nativeDir "..\src\wasm"
$outputFile = Join-Path $outputDir "surface_extractor.wasm"
$objectFile = Join-Path $nativeDir "surface_extractor.o"
$simdObjectFile = Join-Path $nativeDir "surface_extractor.simd.o"
$simdOutputFile = Join-Path $outputDir "surface_extractor.simd.wasm"
$sharedObjectFile = Join-Path $nativeDir "surface_extractor.shared.o"
$sharedOutputFile = Join-Path $outputDir "surface_extractor.shared.wasm"

if (-not $env:EMSDK) {
    throw "EMSDK is not set. Activate an Emscripten SDK environment before running this script."
}

$llvmDir = Join-Path $env:EMSDK "upstream\bin"
$clang = Join-Path $llvmDir "clang++.exe"
$sysroot = Join-Path $env:EMSDK "upstream\emscripten\cache\sysroot"
$libDir = Join-Path $sysroot "lib\wasm32-emscripten"
if (-not (Test-Path $clang)) { throw "clang++.exe was not found under EMSDK: $clang" }

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$compileArgs = @(
    "--target=wasm32-unknown-emscripten", "--sysroot=$sysroot",
    "-isystem", (Join-Path $sysroot "include\compat"),
    "-std=c++17", "-O3", "-flto", "-fno-exceptions", "-D_LIBCPP_HAS_NO_EXCEPTIONS",
    "-c", (Join-Path $nativeDir "surface_extractor.cpp"), "-o", $objectFile
)
& $clang @compileArgs
if ($LASTEXITCODE -ne 0) { throw "C++ compilation failed with exit code $LASTEXITCODE" }

$exportNames = @(
    "__wasm_call_ctors", "malloc", "free", "surface_extract",
    "surface_poly_offsets_ptr", "surface_poly_offsets_len",
    "surface_poly_connectivity_ptr", "surface_poly_connectivity_len",
    "surface_poly_sources_ptr", "surface_poly_sources_len",
    "surface_strip_offsets_ptr", "surface_strip_offsets_len",
    "surface_strip_connectivity_ptr", "surface_strip_connectivity_len",
    "surface_strip_sources_ptr", "surface_strip_sources_len",
    "warp_points", "warp_points_range", "smooth_points", "contour_lines",
    "clip_triangles", "cut_segments", "weld_points", "weld_unique_count",
    "parse_ascii_f32", "parse_ascii_i32", "decode_base64",
    "byte_output_ptr", "byte_output_len",
    "point_output_ptr", "point_output_len",
    "scalar_output_ptr", "scalar_output_len",
    "interpolation_source_a_ptr", "interpolation_source_a_len",
    "interpolation_source_b_ptr", "interpolation_source_b_len",
    "interpolation_amount_ptr", "interpolation_amount_len"
)
$linkArgs = @(
    "--target=wasm32-unknown-emscripten", $objectFile, "-nostdlib", "-L$libDir",
    "-Wl,--no-entry", "-Wl,--export-memory", "-Wl,--initial-memory=16777216",
    "-Wl,--max-memory=4294967296"
)
$linkArgs += $exportNames | ForEach-Object { "-Wl,--export=$_" }
$linkArgs += @(
    "-lc++-noexcept", "-lc++abi-noexcept", "-lc", "-lemmalloc",
    "-lstandalonewasm-nocatch-memgrow-pure", (Join-Path $libDir "libclang_rt.builtins.a"),
    "-o", $outputFile
)
& $clang @linkArgs
if ($LASTEXITCODE -ne 0) { throw "WASM linking failed with exit code $LASTEXITCODE" }

# Browsers with SIMD load this auto-vectorized variant; the baseline module remains universal.
$simdCompileArgs = @($compileArgs[0..($compileArgs.Length - 5)]) + @(
    "-msimd128", "-c", (Join-Path $nativeDir "surface_extractor.cpp"), "-o", $simdObjectFile
)
& $clang @simdCompileArgs
if ($LASTEXITCODE -ne 0) { throw "SIMD C++ compilation failed with exit code $LASTEXITCODE" }
$simdLinkArgs = $linkArgs.Clone()
$simdLinkArgs[1] = $simdObjectFile
$simdLinkArgs[$simdLinkArgs.Length - 1] = $simdOutputFile
& $clang @simdLinkArgs
if ($LASTEXITCODE -ne 0) { throw "SIMD WASM linking failed with exit code $LASTEXITCODE" }

$sharedCompileArgs = @(
    "--target=wasm32-unknown-emscripten", "-O3", "-msimd128", "-matomics", "-mbulk-memory",
    "-c", (Join-Path $nativeDir "shared_kernels.cpp"), "-o", $sharedObjectFile
)
& $clang @sharedCompileArgs
if ($LASTEXITCODE -ne 0) { throw "Shared-memory C++ compilation failed with exit code $LASTEXITCODE" }
$sharedLinkArgs = @(
    "--target=wasm32-unknown-emscripten", $sharedObjectFile, "-nostdlib", "-matomics", "-mbulk-memory",
    "-Wl,--no-entry", "-Wl,--shared-memory", "-Wl,--import-memory",
    "-Wl,--initial-memory=65536", "-Wl,--max-memory=4294967296",
    "-Wl,--export=warp_points_range", "-o", $sharedOutputFile
)
& $clang @sharedLinkArgs
if ($LASTEXITCODE -ne 0) { throw "Shared-memory WASM linking failed with exit code $LASTEXITCODE" }

Remove-Item -LiteralPath $objectFile -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $simdObjectFile -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $sharedObjectFile -ErrorAction SilentlyContinue

Write-Host "Built $outputFile"
