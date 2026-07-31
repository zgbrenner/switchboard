import { createHash } from 'node:crypto';
import { appendBrevityInstruction } from './brevity.mjs';
import { chunkText, reassembleChunks } from './chunking.mjs';
import { convertAttachment as defaultConvertAttachment } from './files.mjs';
import { compressChunks as defaultCompressChunks } from './sidecar.mjs';

const PIPELINE_VERSION = '2026-07-31';

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function attachmentSection(attachment) {
  const safeName = attachment.name.replace(/[\r\n]/gu, ' ').trim();
  return `\n\n<!-- switchboard:attachment:start -->\n# Attachment: ${safeName}\n\n${attachment.markdown}\n<!-- switchboard:attachment:end -->`;
}

function savingsRatio(before, after) {
  if (before === 0 || after >= before) return 0;
  return Math.min(1, Math.max(0, (before - after) / before));
}

function validCompressedChunks(result, originalChunks) {
  if (!result || !Array.isArray(result.chunks) || result.chunks.length !== originalChunks.length) return false;
  return result.chunks.every((chunk) => chunk && typeof chunk.text === 'string');
}

export async function prepareRequest(normalized, dependencies = {}) {
  const routeRequest = dependencies.route;
  const convertAttachment = dependencies.convertAttachment ?? defaultConvertAttachment;
  const compressChunks = dependencies.compressChunks ?? defaultCompressChunks;
  const warnings = [];
  const transforms = [];
  const convertedAttachments = [];
  const originalPrompt = normalized.route.request.prompt;
  let preparedPrompt = originalPrompt;
  let route = null;

  const stages = {
    routing: { enabled: normalized.features.routing, status: normalized.features.routing ? 'skipped' : 'disabled' },
    fileToMarkdown: {
      enabled: normalized.features.fileToMarkdown,
      status: normalized.features.fileToMarkdown ? 'skipped' : 'disabled',
      inputCount: normalized.attachments.length,
      convertedCount: 0,
    },
    compression: {
      enabled: normalized.features.compression,
      status: normalized.features.compression ? 'skipped' : 'disabled',
      model: null,
      originalCharacters: originalPrompt.length,
      preparedCharacters: originalPrompt.length,
      savingsRatio: 0,
      chunkCount: 0,
    },
    brevity: {
      enabled: normalized.features.brevity,
      status: normalized.features.brevity ? 'skipped' : 'disabled',
      level: normalized.features.brevity ? normalized.brevity.level : null,
    },
  };

  if (normalized.features.routing) {
    if (typeof routeRequest !== 'function') {
      stages.routing.status = 'failed';
      warnings.push('Routing was enabled but no routing dependency was configured.');
    } else {
      try {
        route = await routeRequest(normalized.route);
        stages.routing.status = 'applied';
      } catch (error) {
        stages.routing.status = 'failed';
        warnings.push(`Routing failed: ${errorMessage(error)}`);
      }
    }
  }

  if (normalized.features.fileToMarkdown) {
    if (normalized.attachments.length === 0) stages.fileToMarkdown.status = 'skipped';
    else {
      for (const attachment of normalized.attachments) {
        try {
          const converted = await convertAttachment(attachment);
          convertedAttachments.push(converted);
          warnings.push(...(converted.warnings ?? []).map((warning) => `${attachment.name}: ${warning}`));
        } catch (error) {
          warnings.push(`File conversion failed for ${attachment.name}: ${errorMessage(error)}`);
        }
      }
      stages.fileToMarkdown.convertedCount = convertedAttachments.length;
      stages.fileToMarkdown.status = convertedAttachments.length > 0 ? 'applied' : 'failed';
      if (convertedAttachments.length > 0) {
        preparedPrompt += convertedAttachments.map(attachmentSection).join('');
        transforms.push('files:markdown');
      }
    }
  }

  if (normalized.features.compression) {
    const beforeCompression = preparedPrompt;
    stages.compression.originalCharacters = beforeCompression.length;
    if (beforeCompression.length < normalized.compression.minimumCharacters) {
      stages.compression.status = 'bypassed';
      stages.compression.preparedCharacters = beforeCompression.length;
    } else {
      const chunks = chunkText(beforeCompression, { maxCharacters: normalized.compression.maxChunkCharacters });
      stages.compression.chunkCount = chunks.length;
      try {
        const result = await compressChunks(chunks, normalized.compression);
        if (!validCompressedChunks(result, chunks)) throw new Error('Compressor returned an invalid chunk set.');
        const candidate = reassembleChunks(result.chunks);
        const ratio = savingsRatio(beforeCompression.length, candidate.length);
        stages.compression.model = typeof result.model === 'string' ? result.model : null;
        warnings.push(...(result.warnings ?? []));
        if (!candidate.trim() || ratio < normalized.compression.minimumSavingsRatio) {
          stages.compression.status = 'bypassed';
          stages.compression.preparedCharacters = beforeCompression.length;
          stages.compression.savingsRatio = 0;
        } else {
          preparedPrompt = candidate;
          stages.compression.status = result.fallback ? 'fallback' : 'applied';
          stages.compression.preparedCharacters = candidate.length;
          stages.compression.savingsRatio = ratio;
          transforms.push(...(result.transforms ?? []));
        }
      } catch (error) {
        preparedPrompt = beforeCompression;
        stages.compression.status = 'fallback';
        stages.compression.preparedCharacters = beforeCompression.length;
        stages.compression.savingsRatio = 0;
        warnings.push(`Compression failed; the original text was preserved: ${errorMessage(error)}`);
      }
    }
  }

  if (normalized.features.brevity) {
    preparedPrompt = appendBrevityInstruction(preparedPrompt, normalized.brevity.level);
    stages.brevity.status = 'applied';
    transforms.push(`reply:brevity:${normalized.brevity.level}`);
  }

  return {
    pipelineVersion: PIPELINE_VERSION,
    features: normalized.features,
    route,
    preparedPrompt,
    convertedAttachments,
    stages,
    warnings: [...new Set(warnings)],
    transforms: [...new Set(transforms)],
    receipt: { algorithm: 'sha256', originalHash: hash(originalPrompt), preparedHash: hash(preparedPrompt) },
  };
}
