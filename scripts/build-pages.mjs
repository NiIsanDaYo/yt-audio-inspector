import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCli = process.env.npm_execpath;
const buildCommand = npmCli ? process.execPath : 'npm';
const buildArgs = npmCli ? [npmCli, 'run', 'build'] : ['run', 'build'];
const wasmUrl = '/ffmpeg-core/ffmpeg-core.wasm.br';

const build = spawnSync(buildCommand, buildArgs, {
  cwd: root,
  env: {
    ...process.env,
    VITE_FFMPEG_WASM_URL: wasmUrl
  },
  stdio: 'inherit'
});

if (build.error) {
  throw build.error;
}

if (build.status !== 0) {
  throw new Error(`Pages build failed with exit code ${build.status ?? build.signal}`);
}

const wasmPath = join(root, 'dist', 'ffmpeg-core', 'ffmpeg-core.wasm');
if (!existsSync(wasmPath)) {
  throw new Error(`Expected wasm asset not found: ${wasmPath}`);
}

const wasm = readFileSync(wasmPath);
const compressed = brotliCompressSync(wasm, {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY
  }
});
const compressedPath = `${wasmPath}.br`;

writeFileSync(compressedPath, compressed);
rmSync(wasmPath);

const rawMiB = (wasm.length / 1024 / 1024).toFixed(1);
const compressedMiB = (statSync(compressedPath).size / 1024 / 1024).toFixed(1);
console.log(`Prepared Pages wasm asset: ${rawMiB} MiB raw -> ${compressedMiB} MiB Brotli (${wasmUrl})`);
