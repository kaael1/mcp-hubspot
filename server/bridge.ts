import http, { type IncomingMessage, type ServerResponse } from 'node:http';

import { ZodError } from 'zod';

import { bridgeHost, bridgeOrigin, bridgePort } from '../shared/constants.js';
import {
  autopilotSettingsSchema,
  browserTaskInputSchema,
  browserTaskTimeoutInputSchema,
  getAuditLogInputSchema,
  getOperationInputSchema,
  openRecordInputSchema,
  operationResultSchema,
  pageSnapshotSchema,
  pairRequestSchema,
  previewRecordUpdateInputSchema,
  requestAssociationCreateInputSchema,
  requestAssociatedContactsCreateInputSchema,
  requestBatchUpdateInputSchema,
  requestTimelineActivityCreateInputSchema,
  requestRecordFillInputSchema,
  requestRecordCreateInputSchema,
  requestRecordUpdateInputSchema,
  searchRecordsInputSchema,
  setAutopilotInputSchema,
  taskResultSchema,
} from '../shared/schemas.js';
import {
  approveOperation,
  claimNextTask,
  createBrowserTask,
  createOperation,
  completeOperation,
  completeTask,
  getAuditLog,
  getBrowserTask,
  getContext,
  getOperation,
  getPairingKey,
  markOperationRunning,
  pairExtension,
  previewUpdate,
  rejectOperation,
  saveSnapshot,
  setAutopilot,
  touchExtension,
  verifyPairingKey,
  waitForTask,
} from './state.js';
import { coverageMatrix } from '../shared/coverage.js';

const allowedOrigin = (request: IncomingMessage) => {
  const origin = request.headers.origin;
  if (!origin) return null;
  if (origin === bridgeOrigin) return origin;
  if (origin.startsWith('chrome-extension://')) return origin;
  return false;
};

const sendJson = (request: IncomingMessage, response: ServerResponse, status: number, payload: unknown) => {
  const origin = allowedOrigin(request);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'content-type,x-hubspot-mcp-key',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }

  response.writeHead(status, headers);
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
};

const readJsonBody = async (request: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });

const getAuthKey = (request: IncomingMessage) => {
  const header = request.headers['x-hubspot-mcp-key'];
  return Array.isArray(header) ? header[0] : header;
};

const getExtensionIdFromOrigin = (request: IncomingMessage) => {
  const origin = request.headers.origin;
  if (!origin?.startsWith('chrome-extension://')) return null;

  try {
    return new URL(origin).hostname || null;
  } catch {
    return null;
  }
};

const isTrustedPairedExtension = (request: IncomingMessage) => {
  const extensionId = getExtensionIdFromOrigin(request);
  const pairedExtensionId = getContext().pairedExtension?.extensionId;
  return Boolean(extensionId && pairedExtensionId && extensionId === pairedExtensionId);
};

const requireAuth = (request: IncomingMessage) => {
  if (!verifyPairingKey(getAuthKey(request)) && !isTrustedPairedExtension(request)) {
    throw Object.assign(new Error('Bridge request is not paired.'), { statusCode: 401 });
  }
};

const runBrowserTask = async (
  type: 'capture_snapshot' | 'open_record' | 'search_records',
  input: unknown,
  timeoutMs = 5_000,
) => {
  const task = await createBrowserTask(type, input);
  const completed = timeoutMs === 0 ? task : await waitForTask(task.id, timeoutMs);
  if (completed.status === 'pending' || completed.status === 'running') {
    return {
      status: completed.status,
      taskId: completed.id,
    };
  }
  if (completed.status === 'failed') {
    throw new Error(completed.error || `Browser task ${type} failed.`);
  }
  return completed.result;
};

const commandMetadata = [
  { name: 'doctor', risk: 'read' },
  { name: 'get_context', risk: 'read' },
  { name: 'get_coverage_matrix', risk: 'read' },
  { name: 'get_page_snapshot', risk: 'read' },
  { name: 'get_visible_tables', risk: 'read' },
  { name: 'search_records', risk: 'read' },
  { name: 'open_record', risk: 'read' },
  { name: 'get_task', risk: 'read' },
  { name: 'preview_record_update', risk: 'read' },
  { name: 'request_record_update', risk: 'write' },
  { name: 'request_record_fill', risk: 'write' },
  { name: 'request_record_create', risk: 'write' },
  { name: 'request_batch_update', risk: 'write' },
  { name: 'request_timeline_activity_create', risk: 'write' },
  { name: 'request_association_create', risk: 'write' },
  { name: 'request_associated_contacts_create', risk: 'write' },
  { name: 'get_operation', risk: 'read' },
  { name: 'get_audit_log', risk: 'read' },
  { name: 'set_autopilot', risk: 'write' },
] as const;

const executeLocalCommand = async (name: string, input: unknown) => {
  if (name === 'doctor') return getDoctorPayload();
  if (name === 'get_context') return { context: getContext(), ok: true };
  if (name === 'get_coverage_matrix') return { coverage: coverageMatrix, ok: true };
  if (name === 'get_page_snapshot') {
    const { timeoutMs = 5_000 } = browserTaskTimeoutInputSchema.parse(input);
    const result = await runBrowserTask('capture_snapshot', {}, timeoutMs);
    if ((result as { taskId?: unknown }).taskId) {
      const pending = result as { status: string; taskId: string };
      return { ok: true, status: pending.status, taskId: pending.taskId };
    }
    const snapshot = pageSnapshotSchema.parse((result as { snapshot?: unknown })?.snapshot || result);
    await saveSnapshot(snapshot);
    return { ok: true, snapshot };
  }
  if (name === 'get_visible_tables') {
    const { timeoutMs = 5_000 } = browserTaskTimeoutInputSchema.parse(input);
    const result = await runBrowserTask('capture_snapshot', {}, timeoutMs);
    if ((result as { taskId?: unknown }).taskId) {
      const pending = result as { status: string; taskId: string };
      return { ok: true, status: pending.status, taskId: pending.taskId };
    }
    const snapshot = pageSnapshotSchema.parse((result as { snapshot?: unknown })?.snapshot || result);
    await saveSnapshot(snapshot);
    return { ok: true, tables: snapshot.tables || [] };
  }
  if (name === 'search_records') {
    const parsed = searchRecordsInputSchema.parse(input);
    return { ok: true, result: await runBrowserTask('search_records', parsed, parsed.timeoutMs ?? 5_000) };
  }
  if (name === 'open_record') {
    const parsed = openRecordInputSchema.parse(input);
    return { ok: true, result: await runBrowserTask('open_record', parsed, parsed.timeoutMs ?? 5_000) };
  }
  if (name === 'get_task') {
    const parsed = browserTaskInputSchema.parse(input);
    return { ok: true, task: getBrowserTask(parsed.taskId) };
  }
  if (name === 'preview_record_update') return { ok: true, ...previewUpdate(previewRecordUpdateInputSchema.parse(input)) };
  if (name === 'request_record_update') {
    const parsed = requestRecordUpdateInputSchema.parse(input);
    return createOperation({
      fields: parsed.fields,
      kind: 'update',
      objectId: parsed.target?.objectId,
      objectLabel: parsed.target?.objectLabel,
      target: parsed.target,
      type: parsed.target?.type || 'contact',
    });
  }
  if (name === 'request_record_fill') {
    const parsed = requestRecordFillInputSchema.parse(input);
    return createOperation({
      fields: parsed.fields,
      kind: 'fill-only',
      objectId: parsed.target?.objectId,
      objectLabel: parsed.target?.objectLabel,
      target: parsed.target,
      type: parsed.target?.type || 'contact',
    });
  }
  if (name === 'request_record_create') {
    const parsed = requestRecordCreateInputSchema.parse(input);
    return createOperation({ fields: parsed.fields, kind: 'create', objectId: parsed.objectId, objectLabel: parsed.objectLabel, type: parsed.type });
  }
  if (name === 'request_batch_update') {
    const parsed = requestBatchUpdateInputSchema.parse(input);
    return createOperation({ items: parsed.items, kind: 'batch-update', objectId: parsed.objectId, objectLabel: parsed.objectLabel, type: parsed.type });
  }
  if (name === 'request_timeline_activity_create') {
    const parsed = requestTimelineActivityCreateInputSchema.parse(input);
    return createOperation({ activity: parsed, kind: 'create-activity', type: parsed.target?.type || 'contact' });
  }
  if (name === 'request_association_create') {
    const parsed = requestAssociationCreateInputSchema.parse(input);
    return createOperation({ association: parsed, kind: 'associate-record', type: parsed.from?.type || parsed.to.type });
  }
  if (name === 'request_associated_contacts_create') {
    const parsed = requestAssociatedContactsCreateInputSchema.parse(input);
    return createOperation({ company: parsed.company, contactCreates: parsed.contacts, kind: 'create-associated-contacts', type: 'contact' });
  }
  if (name === 'get_operation') {
    const parsed = getOperationInputSchema.parse(input);
    return { ok: true, operation: getOperation(parsed.operationId) };
  }
  if (name === 'get_audit_log') {
    const { limit = 50 } = getAuditLogInputSchema.parse(input);
    return { audit: getAuditLog(limit), ok: true };
  }
  if (name === 'set_autopilot') {
    const parsed = setAutopilotInputSchema.parse(input);
    return { ok: true, autopilot: await setAutopilot(parsed.enabled) };
  }

  throw Object.assign(new Error(`Unknown command: ${name}`), { statusCode: 404 });
};

const routeOperation = async (request: IncomingMessage, response: ServerResponse, pathname: string) => {
  const [, , operationId, action] = pathname.split('/');
  if (!operationId) {
    sendJson(request, response, 404, { error: 'Route not found.' });
    return true;
  }

  if (request.method === 'GET' && !action) {
    const operation = getOperation(operationId);
    sendJson(request, response, operation ? 200 : 404, operation ? { ok: true, operation } : { error: 'Operation not found.' });
    return true;
  }

  if (request.method === 'POST' && action === 'approve') {
    sendJson(request, response, 200, { ok: true, operation: await approveOperation(operationId) });
    return true;
  }

  if (request.method === 'POST' && action === 'reject') {
    sendJson(request, response, 200, { ok: true, operation: await rejectOperation(operationId) });
    return true;
  }

  if (request.method === 'POST' && action === 'running') {
    sendJson(request, response, 200, { ok: true, operation: await markOperationRunning(operationId) });
    return true;
  }

  if (request.method === 'POST' && action === 'result') {
    const body = operationResultSchema.parse(await readJsonBody(request));
    sendJson(request, response, 200, { ok: true, operation: await completeOperation(operationId, body) });
    return true;
  }

  return false;
};

export const createBridgeServer = () =>
  http.createServer(async (request, response) => {
    try {
      if (!request.url) {
        sendJson(request, response, 400, { error: 'Missing request URL.' });
        return;
      }

      const origin = allowedOrigin(request);
      if (origin === false) {
        sendJson(request, response, 403, { error: 'Origin not allowed.' });
        return;
      }

      if (request.method === 'OPTIONS') {
        sendJson(request, response, 204, { ok: true });
        return;
      }

      const url = new URL(request.url, bridgeOrigin);
      const { pathname } = url;

      if (request.method === 'GET' && pathname === '/health') {
        sendJson(request, response, 200, {
          context: getContext(),
          ok: true,
          paired: Boolean(getContext().pairedExtension),
          port: bridgePort,
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/pair') {
        const body = pairRequestSchema.parse(await readJsonBody(request));
        sendJson(request, response, 200, { ok: true, pairedExtension: await pairExtension(body) });
        return;
      }

      requireAuth(request);
      await touchExtension();

      if (request.method === 'GET' && pathname === '/context') {
        sendJson(request, response, 200, { context: getContext(), ok: true });
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/commands') {
        sendJson(request, response, 200, { commands: commandMetadata, ok: true });
        return;
      }

      if (request.method === 'POST' && pathname.startsWith('/v1/commands/')) {
        const commandName = decodeURIComponent(pathname.replace('/v1/commands/', ''));
        const body = await readJsonBody(request);
        sendJson(request, response, 200, {
          ok: true,
          result: await executeLocalCommand(commandName, body),
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/snapshot') {
        const body = pageSnapshotSchema.parse(await readJsonBody(request));
        sendJson(request, response, 200, { ok: true, snapshot: await saveSnapshot(body) });
        return;
      }

      if (request.method === 'GET' && pathname === '/tasks/next') {
        sendJson(request, response, 200, { ok: true, task: await claimNextTask() });
        return;
      }

      if (request.method === 'GET' && pathname.startsWith('/tasks/')) {
        const taskId = decodeURIComponent(pathname.replace('/tasks/', ''));
        sendJson(request, response, 200, { ok: true, task: getBrowserTask(taskId) });
        return;
      }

      if (request.method === 'POST' && pathname.startsWith('/tasks/') && pathname.endsWith('/result')) {
        const taskId = pathname.replace('/tasks/', '').replace('/result', '');
        const body = taskResultSchema.parse(await readJsonBody(request));
        sendJson(request, response, 200, { ok: true, task: await completeTask(taskId, body) });
        return;
      }

      if (request.method === 'GET' && pathname === '/operations') {
        sendJson(request, response, 200, { ok: true, operations: getContext().pendingOperations });
        return;
      }

      if (request.method === 'GET' && pathname === '/settings/autopilot') {
        sendJson(request, response, 200, { autopilot: autopilotSettingsSchema.parse(getContext().settings.autopilot), ok: true });
        return;
      }

      if (request.method === 'POST' && pathname === '/settings/autopilot') {
        const body = setAutopilotInputSchema.parse(await readJsonBody(request));
        sendJson(request, response, 200, { autopilot: await setAutopilot(body.enabled), ok: true });
        return;
      }

      if (pathname.startsWith('/operations/') && (await routeOperation(request, response, pathname))) {
        return;
      }

      if (request.method === 'GET' && pathname === '/audit') {
        const limit = Number(url.searchParams.get('limit') || 50);
        sendJson(request, response, 200, { audit: getAuditLog(limit), ok: true });
        return;
      }

      sendJson(request, response, 404, { error: 'Route not found.' });
    } catch (error) {
      if (error instanceof ZodError) {
        sendJson(request, response, 400, { details: error.issues, error: 'Invalid request payload.' });
        return;
      }

      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
      sendJson(request, response, statusCode, { error: error instanceof Error ? error.message : String(error) });
    }
  });

export const listen = (server: ReturnType<typeof createBridgeServer>) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(bridgePort, bridgeHost, () => {
      server.off('error', reject);
      resolve();
    });
  });

export const getDoctorPayload = () => ({
  bridge: {
    host: bridgeHost,
    pairingKey: getPairingKey(),
    port: bridgePort,
    url: bridgeOrigin,
  },
  context: getContext(),
  ok: true,
});
