import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deterministicCompressChunks } from './content.mjs';

const MAX_SIDECAR_OUTPUT_BYTES = 32 * 1024 * 1024;

function targetName() {
  return `${process.platform}-${process.arch}`;
}

function packageRoot() {
  return fileURLToPath(new URL('../../', import.meta.url));
}

function bundledExecutable() {
  const name = process.platform === 'win32' ? 'switchboard-compressor.exe' : 'switchboard-compressor';
  return join(packageRoot(), 'bin', targetName(), name);
}

function bundledModelDirectory() {
  return join(packageRoot(), 'models', 'kompress-small');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveRuntime(options) {
  const executable = options.executable ?? process.env.SWITCHBOARD_COMPRESSOR_BIN ?? bundledExecutable();
  const modelDirectory = options.modelDirectory ?? process.env.SWITCHBOARD_COMPRESSOR_MODEL ?? bundledModelDirectory();
  if (!(await exists(executable)) || !(await exists(modelDirectory))) return null;
  return { executable, modelDirectory };
}

function sidecarRequest(chunks, options) {
  return {
    version: 1,
    modelDirectory: options.modelDirectory,
    threshold: options.threshold,
    chunks: chunks.map((chunk) => ({ text: chunk.text, protected: Boolean(chunk.protected) })),
  };
}

function runSidecar(runtime, chunks, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.executable, ['--model', runtime.modelDirectory], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`Compressor timed out after ${options.timeoutMs}ms.`)));
    }, options.timeoutMs);

    child.stdout.on('data', (data) => {
      stdoutBytes += data.length;
      if (stdoutBytes > MAX_SIDECAR_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(() => reject(new Error('Compressor output exceeded the safety limit.')));
      } else stdout.push(data);
    });
    child.stderr.on('data', (data) => {
      if (Buffer.concat(stderr).length < 64_000) stderr.push(data);
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString('utf8').trim();
          reject(new Error(`Compressor exited with code ${code}${detail ? `: ${detail}` : ''}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')));
        } catch (error) {
          reject(new Error(`Compressor returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
    child.stdin.end(JSON.stringify(sidecarRequest(chunks, { ...options, modelDirectory: runtime.modelDirectory })));
  });
}

function normalizeSidecarResult(result, chunks) {
  if (!result || !Array.isArray(result.chunks) || result.chunks.length !== chunks.length) {
    throw new Error('Compressor returned the wrong number of chunks.');
  }
  const normalized = result.chunks.map((text, index) => {
    if (typeof text !== 'string') throw new Error(`Compressor chunk ${index} is not text.`);
    return { ...chunks[index], text };
  });
  return {
    chunks: normalized,
    model: typeof result.model === 'string' ? result.model : 'kompress-small-int8',
    transforms: Array.isArray(result.transforms) ? result.transforms.filter((value) => typeof value === 'string') : ['model:kompress-small-int8'],
    warnings: Array.isArray(result.warnings) ? result.warnings.filter((value) => typeof value === 'string') : [],
    fallback: false,
  };
}

export async function compressChunks(chunks, options = {}) {
  if (options.mode === 'deterministic') return { ...deterministicCompressChunks(chunks), fallback: false };
  const runtime = await resolveRuntime(options);
  if (runtime) {
    try {
      return normalizeSidecarResult(await runSidecar(runtime, chunks, options), chunks);
    } catch (error) {
      if (options.mode === 'model') throw error;
      const fallback = deterministicCompressChunks(chunks);
      return {
        ...fallback,
        fallback: true,
        warnings: [`Quantized compressor unavailable; conservative fallback used: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
  if (options.mode === 'model') throw new Error('The quantized Kompress-Small sidecar or model bundle is unavailable.');
  const fallback = deterministicCompressChunks(chunks);
  return {
    ...fallback,
    fallback: true,
    warnings: ['Quantized compressor bundle not found; conservative deterministic compression was used.'],
  };
}
