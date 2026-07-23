import { inspectBytes } from './inspect.js';
import type { FileInsight } from '../shared/types.js';

interface InspectionRequest {
  id: number;
  name: string;
  declaredType: string;
  buffer: ArrayBuffer;
}

interface InspectionResponse {
  id: number;
  result?: FileInsight;
  error?: string;
}

const scope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<InspectionRequest>) => void): void;
  postMessage(message: InspectionResponse): void;
};

scope.addEventListener('message', (event) => {
  const request = event.data;
  void inspectBytes({
    name: request.name,
    declaredType: request.declaredType,
    bytes: new Uint8Array(request.buffer),
  }).then(
    (result) => scope.postMessage({ id: request.id, result }),
    (error: unknown) => scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }),
  );
});
