import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = 'model-packs/local';

const packs = {
  scout: {
    id: 'switchboard-scout-minilm-l6-v2',
    stage: 'scout',
    repo: 'onnx-community/all-MiniLM-L6-v2-ONNX',
    revision: 'aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f',
    destination: 'switchboard/scout',
    quantization: 'q4',
    assets: [
      'config.json', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt',
      'onnx/model_q4.onnx', 'onnx/model_q4.onnx_data',
    ],
  },
  arbiter: {
    id: 'switchboard-arbiter-msmarco-minilm-l6-v2',
    stage: 'arbiter',
    repo: 'Xenova/ms-marco-MiniLM-L-6-v2',
    revision: 'a091443',
    destination: 'switchboard/arbiter',
    quantization: 'uint8',
    assets: [
      'config.json', 'quantize_config.json', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt',
      'onnx/model_uint8.onnx',
    ],
  },
  judge: {
    id: 'switchboard-judge-smollm2-135m',
    stage: 'judge',
    repo: 'onnx-community/SmolLM2-135M-Instruct-ONNX',
    revision: 'b8a5c0f183b78c55955a5364f610c36668b5e681',
    destination: 'switchboard/judge',
    quantization: 'q4f16',
    assets: [
      'config.json', 'generation_config.json', 'merges.txt', 'quantize_config.json', 'special_tokens_map.json',
      'tokenizer.json', 'tokenizer_config.json', 'vocab.json', 'onnx/model_q4f16.onnx',
    ],
  },
};

function selectedPacks(mode) {
  if (mode === 'core') return [packs.scout, packs.arbiter];
  if (mode === 'all') return [packs.scout, packs.arbiter, packs.judge];
  if (mode in packs) return [packs[mode]];
  throw new Error('Usage: node scripts/fetch-models.mjs [core|all|scout|arbiter|judge]');
}

async function download(url, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary));
  await rename(temporary, destination);
  return { path: destination, sha256: hash.digest('hex'), bytes };
}

async function fetchPack(pack) {
  const directory = join(ROOT, pack.destination);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (const asset of pack.assets) {
    const url = `https://huggingface.co/${pack.repo}/resolve/${pack.revision}/${asset}?download=true`;
    const destination = join(directory, asset);
    process.stdout.write(`Downloading ${pack.id}/${asset}... `);
    const result = await download(url, destination);
    assets.push({ path: asset, sha256: result.sha256, bytes: result.bytes });
    console.log(`${(result.bytes / 1024 / 1024).toFixed(1)} MB`);
  }
  const manifest = {
    schemaVersion: 1,
    id: pack.id,
    stage: pack.stage,
    sourceRepository: pack.repo,
    sourceRevision: pack.revision,
    runtime: 'transformers-js',
    quantization: pack.quantization,
    assets,
  };
  await writeFile(join(directory, 'switchboard-model-pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const mode = process.argv[2] ?? 'core';
for (const pack of selectedPacks(mode)) await fetchPack(pack);
console.log(`Installed ${mode} model pack(s) under ${ROOT}. No runtime network access is required.`);
