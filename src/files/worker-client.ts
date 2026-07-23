import type { DetectedFileType, FileInsight } from '../shared/types.js';

interface InspectionResponse {
  id: number;
  result?: FileInsight;
  error?: string;
}

interface PendingInspection {
  resolve(value: FileInsight): void;
  reject(error: Error): void;
  timer: number;
}

const DEFAULT_TIMEOUT_MS = 14_000;

function metadataType(file: File): DetectedFileType {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'docx';
  if (extension === 'pptx') return 'pptx';
  if (extension === 'xlsx') return 'xlsx';
  if (extension === 'zip') return 'zip';
  if (['md', 'markdown'].includes(extension)) return 'markdown';
  if (['html', 'htm'].includes(extension)) return 'html';
  if (extension === 'json') return 'json';
  if (extension === 'csv') return 'csv';
  if (file.type.startsWith('text/')) return 'text';
  return 'unknown';
}

export function metadataOnlyInsight(file: File, warning: string): FileInsight {
  const detectedType = metadataType(file);
  return {
    name: file.name,
    size: file.size,
    detectedType,
    mediaType: file.type || 'application/octet-stream',
    textLength: 0,
    excerpt: '',
    warnings: [warning, 'metadata-only-routing'],
    capabilities: {
      files: true,
      vision: detectedType === 'image',
      longContext: file.size > 2 * 1024 * 1024,
    },
  };
}

export class FileInspectionClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, PendingInspection>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(chrome.runtime.getURL('file-worker.js'), { type: 'module', name: 'switchboard-file-inspection' });
    worker.addEventListener('message', (event: MessageEvent<InspectionResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      globalThis.clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.result) pending.resolve(response.result);
      else pending.reject(new Error(response.error ?? 'File inspection failed.'));
    });
    worker.addEventListener('error', () => this.restart(new Error('The isolated file worker failed.')));
    this.worker = worker;
    return worker;
  }

  async inspect(file: File, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FileInsight> {
    const id = ++this.sequence;
    try {
      const buffer = await file.arrayBuffer();
      const worker = this.ensureWorker();
      return await new Promise<FileInsight>((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
          this.pending.delete(id);
          this.restart(new Error(`${file.name} exceeded the local inspection timeout.`));
          reject(new Error(`${file.name} exceeded the local inspection timeout.`));
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, name: file.name, declaredType: file.type, buffer }, [buffer]);
      });
    } catch (error) {
      return metadataOnlyInsight(file, error instanceof Error ? error.message : String(error));
    }
  }

  dispose(): void {
    this.restart(new Error('File inspection was cancelled.'));
  }

  private restart(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      globalThis.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
