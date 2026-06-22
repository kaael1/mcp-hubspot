import type { BrowserTask, Operation, OperationStatus, PageSnapshot, SearchRecordsInput, SearchResult } from '../shared/schemas.js';

export type ExtensionStatus = {
  autopilotEnabled: boolean;
  bridgeOk: boolean;
  error?: string;
  hasKey: boolean;
  lastSnapshot?: PageSnapshot | null;
  paired: boolean;
  pendingOperations: Operation[];
};

export type ContentCommand =
  | { type: 'capture_snapshot' }
  | { input: SearchRecordsInput; type: 'collect_results' }
  | { operation: Operation; type: 'execute_operation' };

export type ContentResponse =
  | { ok: true; snapshot: PageSnapshot }
  | { ok: true; results: SearchResult[] }
  | {
      itemResults?: Array<{ error?: string; status: OperationStatus }>;
      ok: true;
      result?: unknown;
      status: 'paused' | 'succeeded';
    }
  | { error: string; ok: false };

export type RuntimeMessage =
  | { key: string; type: 'pair' }
  | { type: 'get-status' }
  | { operationId: string; type: 'approve-operation' }
  | { operationId: string; type: 'reject-operation' }
  | { enabled: boolean; type: 'set-autopilot' }
  | { type: 'open-side-panel' };

export type TaskEnvelope = {
  ok: true;
  task: BrowserTask | null;
};
