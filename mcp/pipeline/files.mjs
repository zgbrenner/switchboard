import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter as pathDelimiter, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_MARKDOWN_CHARACTERS = 8_000_000;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.log', '.rst']);
const BINARY_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.xls', '.epub', '.zip', '.xml', '.rss', '.atom']);

function extensionOf(attachment) {
  return extname(attachment.name || attachment.path || '').toLowerCase();
}

function cleanText(buffer) {
  return buffer.toString('utf8').replace(/^\uFEFF/u, '');
}

function decodeBase64(value) {
  const normalized = value.replace(/\s/gu, '');
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    throw new Error('attachment.contentBase64 is not valid base64.');
  }
  const bytes = Buffer.from(normalized, 'base64');
  const canonical = bytes.toString('base64').replace(/=+$/u, '');
  if (canonical !== normalized.replace(/=+$/u, '')) throw new Error('attachment.contentBase64 is not valid base64.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit.`);
  return bytes;
}

function looksRemote(value) {
  return /^(?:https?|ftp|data|file):/iu.test(value) || (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) && !/^[A-Za-z]:[\\/]/u.test(value));
}

function configuredRoots() {
  const configured = process.env.SWITCHBOARD_ALLOWED_FILE_ROOTS?.split(pathDelimiter).filter(Boolean) ?? [];
  return configured.length > 0 ? configured : [process.cwd()];
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function safeLocalPath(input, allowedRoots = configuredRoots()) {
  if (looksRemote(input)) throw new Error('attachment.path must be a local path; remote URLs are not fetched.');
  const candidate = await realpath(resolve(input));
  if (process.env.SWITCHBOARD_ALLOW_ANY_LOCAL_FILE !== '1') {
    const roots = await Promise.all(allowedRoots.map(async (root) => await realpath(resolve(root))));
    if (!roots.some((root) => inside(root, candidate))) {
      throw new Error('attachment.path is outside the configured local file roots.');
    }
  }
  const metadata = await stat(candidate);
  if (!metadata.isFile()) throw new Error('attachment.path must point to a regular file.');
  if (metadata.size > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit.`);
  return candidate;
}

function parseDelimited(text, separator) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === separator) {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  row.push(field.replace(/\r$/u, ''));
  if (row.some((value) => value.length > 0) || rows.length === 0) rows.push(row);
  return rows;
}

function tableCell(value) {
  return value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\r?\n/gu, '<br>').trim();
}

function delimitedToMarkdown(text, separator) {
  const rows = parseDelimited(text, separator);
  const width = Math.max(1, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => tableCell(row[index] ?? '')));
  const header = normalized[0] ?? Array.from({ length: width }, () => '');
  const body = normalized.slice(1);
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...body.map((row) => `| ${row.join(' | ')} |`)].join(
    '\n',
  );
}

const ENTITY_MAP = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (_, entity) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x';
      const value = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? _;
  });
}

function htmlToMarkdown(html) {
  let output = html.replace(/<!--[\s\S]*?-->/gu, '');
  output = output.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, '');
  for (let level = 6; level >= 1; level -= 1) {
    const pattern = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'giu');
    output = output.replace(pattern, `${'#'.repeat(level)} $1\n\n`);
  }
  output = output.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu, '[$2]($1)');
  output = output.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/giu, '**$2**');
  output = output.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/giu, '*$2*');
  output = output.replace(/<li\b[^>]*>/giu, '- ').replace(/<\/li>/giu, '\n');
  output = output.replace(/<br\s*\/?\s*>/giu, '\n');
  output = output.replace(/<\/?(?:p|div|section|article|header|footer|main|aside|ul|ol|table|tr)\b[^>]*>/giu, '\n');
  output = output.replace(/<[^>]+>/gu, '');
  output = decodeEntities(output);
  return output
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function notebookToMarkdown(text) {
  const notebook = JSON.parse(text);
  if (!Array.isArray(notebook.cells)) throw new Error('Jupyter notebook has no cells array.');
  const sections = [];
  for (const cell of notebook.cells) {
    const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
    if (cell.cell_type === 'markdown') sections.push(source.trim());
    else if (cell.cell_type === 'code') {
      sections.push(`\`\`\`python\n${source.trimEnd()}\n\`\`\``);
      for (const output of cell.outputs ?? []) {
        const value = Array.isArray(output.text) ? output.text.join('') : output.text;
        if (value) sections.push(`\`\`\`text\n${String(value).trimEnd()}\n\`\`\``);
      }
    }
  }
  return sections.filter(Boolean).join('\n\n');
}

function internalConversion(bytes, extension) {
  const text = cleanText(bytes);
  if (TEXT_EXTENSIONS.has(extension)) return text;
  if (extension === '.csv') return delimitedToMarkdown(text, ',');
  if (extension === '.tsv') return delimitedToMarkdown(text, '\t');
  if (extension === '.json') return `\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\``;
  if (extension === '.jsonl') return `\`\`\`jsonl\n${text.trim()}\n\`\`\``;
  if (extension === '.html' || extension === '.htm') return htmlToMarkdown(text);
  if (extension === '.ipynb') return notebookToMarkdown(text);
  return null;
}

function platformTarget() {
  return `${process.platform}-${process.arch}`;
}

function bundledMarkItDownPath() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const executable = process.platform === 'win32' ? 'markitdown.exe' : 'markitdown';
  return join(root, 'bin', platformTarget(), executable);
}

async function existingExecutable(candidate) {
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

async function markItDownPath(override) {
  if (override) return override;
  if (process.env.SWITCHBOARD_MARKITDOWN_BIN) return process.env.SWITCHBOARD_MARKITDOWN_BIN;
  return await existingExecutable(bundledMarkItDownPath());
}

async function convertWithSidecar(path, options) {
  const executable = await markItDownPath(options.markItDownPath);
  if (!executable) {
    throw new Error('The MarkItDown sidecar is unavailable. Install a full Switchboard release bundle or set SWITCHBOARD_MARKITDOWN_BIN.');
  }
  const { stdout } = await execFileAsync(executable, [path], {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: MAX_MARKDOWN_CHARACTERS * 2,
    windowsHide: true,
  });
  if (stdout.length > MAX_MARKDOWN_CHARACTERS) throw new Error('Converted Markdown exceeds the output limit.');
  return stdout.trim();
}

async function attachmentBytesAndPath(attachment, options) {
  if (attachment.path !== undefined) {
    const path = await safeLocalPath(attachment.path, options.allowedRoots);
    return { bytes: await readFile(path), path, cleanup: null };
  }
  if (attachment.contentBase64 === undefined) throw new Error('Attachment requires exactly one of path or contentBase64.');
  const bytes = decodeBase64(attachment.contentBase64);
  return { bytes, path: null, cleanup: null };
}

export async function convertAttachment(attachment, options = {}) {
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) throw new Error('attachment must be an object.');
  if (typeof attachment.name !== 'string' || !attachment.name.trim()) throw new Error('attachment.name is required.');
  if ((attachment.path === undefined) === (attachment.contentBase64 === undefined)) {
    throw new Error('Attachment requires exactly one of path or contentBase64.');
  }
  if (attachment.path !== undefined && looksRemote(attachment.path)) {
    throw new Error('attachment.path must be a local path; remote URLs are not fetched.');
  }

  const extension = extensionOf(attachment);
  const source = await attachmentBytesAndPath(attachment, options);
  if (source.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit.`);
  const internal = internalConversion(source.bytes, extension);
  let markdown = internal;
  let temporaryDirectory = null;

  try {
    if (markdown === null) {
      if (!BINARY_EXTENSIONS.has(extension)) throw new Error(`Unsupported attachment type: ${extension || 'unknown'}.`);
      let path = source.path;
      if (!path) {
        temporaryDirectory = await mkdtemp(join(tmpdir(), 'switchboard-file-'));
        path = join(temporaryDirectory, basename(attachment.name));
        await writeFile(path, source.bytes, { flag: 'wx' });
      }
      markdown = await convertWithSidecar(path, options);
    }
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }

  if (markdown.length > MAX_MARKDOWN_CHARACTERS) throw new Error('Converted Markdown exceeds the output limit.');
  return {
    name: attachment.name,
    mediaType: attachment.mediaType ?? 'text/markdown',
    markdown,
    characters: markdown.length,
    warnings: [],
  };
}
