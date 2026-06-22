import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';

import { getDoctorPayload } from './bridge.js';
import {
  createBrowserTask,
  createOperation,
  getBrowserTask,
  getAuditLog,
  getContext,
  getOperation,
  previewUpdate,
  saveSnapshot,
  setAutopilot,
  waitForTask,
} from './state.js';
import {
  browserTaskInputSchema,
  browserTaskTimeoutInputSchema,
  getAuditLogInputSchema,
  getOperationInputSchema,
  openRecordInputSchema,
  pageSnapshotSchema,
  previewRecordUpdateInputSchema,
  requestAssociatedContactsCreateInputSchema,
  requestBatchUpdateInputSchema,
  requestRecordCreateInputSchema,
  requestRecordFillInputSchema,
  requestRecordUpdateInputSchema,
  searchRecordsInputSchema,
  searchResultSchema,
  setAutopilotInputSchema,
} from '../shared/schemas.js';
import { packageName } from '../shared/constants.js';

const emptyInputSchema = z.object({});

type ToolDefinition = {
  description: string;
  handler: (input: unknown) => Promise<unknown> | unknown;
  inputSchema: ZodTypeAny;
  inputShape: ZodRawShape;
  name: string;
};

const createResult = (payload: unknown) => ({
  content: [{ text: JSON.stringify(payload, null, 2), type: 'text' as const }],
  structuredContent: payload as Record<string, unknown>,
});

const createError = (error: unknown) => ({
  content: [
    {
      text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
      type: 'text' as const,
    },
  ],
  isError: true,
  structuredContent: {
    error: error instanceof Error ? error.message : String(error),
  },
});

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

const tools: ToolDefinition[] = [
  {
    description: 'Verify bridge, pairing, extension status, and current HubSpot browser context.',
    handler: () => ({
      ...getDoctorPayload(),
      tools: tools.map(({ description, name }) => ({ description, name })),
    }),
    inputSchema: emptyInputSchema,
    inputShape: {},
    name: 'doctor',
  },
  {
    description: 'Return current page, extension pairing, capabilities, pending tasks, and pending operations.',
    handler: () => ({ context: getContext(), ok: true }),
    inputSchema: emptyInputSchema,
    inputShape: {},
    name: 'get_context',
  },
  {
    description: 'Ask the paired extension to capture a sanitized snapshot of the active HubSpot page.',
    handler: async (input) => {
      const { timeoutMs = 5_000 } = browserTaskTimeoutInputSchema.parse(input);
      const result = await runBrowserTask('capture_snapshot', {}, timeoutMs);
      if ((result as { taskId?: unknown }).taskId) {
        const pending = result as { status: string; taskId: string };
        return { ok: true, status: pending.status, taskId: pending.taskId };
      }
      const snapshot = pageSnapshotSchema.parse((result as { snapshot?: unknown })?.snapshot || result);
      await saveSnapshot(snapshot);
      return { ok: true, snapshot };
    },
    inputSchema: browserTaskTimeoutInputSchema,
    inputShape: {
      timeoutMs: z.number().int().min(0).max(60_000).optional(),
    },
    name: 'get_page_snapshot',
  },
  {
    description: 'Search visible HubSpot contacts or companies through the browser UI.',
    handler: async (input) => {
      const parsed = searchRecordsInputSchema.parse(input);
      const result = await runBrowserTask('search_records', parsed, parsed.timeoutMs ?? 5_000);
      if ((result as { taskId?: unknown }).taskId) {
        const pending = result as { status: string; taskId: string };
        return { ok: true, status: pending.status, taskId: pending.taskId };
      }
      const results = z.array(searchResultSchema).parse((result as { results?: unknown })?.results || []);
      return { ok: true, results };
    },
    inputSchema: searchRecordsInputSchema,
    inputShape: {
      limit: z.number().int().positive().max(25).optional(),
      query: z.string().trim().min(1),
      timeoutMs: z.number().int().min(0).max(60_000).optional(),
      type: z.enum(['contact', 'company']),
    },
    name: 'search_records',
  },
  {
    description: 'Open a HubSpot contact or company by URL, record reference, or search query.',
    handler: async (input) => {
      const parsed = openRecordInputSchema.parse(input);
      return { ok: true, result: await runBrowserTask('open_record', parsed, parsed.timeoutMs ?? 5_000) };
    },
    inputSchema: openRecordInputSchema,
    inputShape: {
      query: z.string().trim().min(1).optional(),
      record: z
        .object({
          displayName: z.string().optional(),
          id: z.string().optional(),
          type: z.enum(['contact', 'company']),
          url: z.string().url().optional(),
        })
        .optional(),
      timeoutMs: z.number().int().min(0).max(60_000).optional(),
      type: z.enum(['contact', 'company']).optional(),
      url: z.string().url().optional(),
    },
    name: 'open_record',
  },
  {
    description: 'Get one queued/running/completed browser task without blocking the assistant.',
    handler: (input) => {
      const { taskId } = browserTaskInputSchema.parse(input);
      return { ok: true, task: getBrowserTask(taskId) };
    },
    inputSchema: browserTaskInputSchema,
    inputShape: {
      taskId: z.string().trim().min(1),
    },
    name: 'get_task',
  },
  {
    description: 'Preview a HubSpot record update without touching the browser page.',
    handler: (input) => ({ ok: true, ...previewUpdate(previewRecordUpdateInputSchema.parse(input)) }),
    inputSchema: previewRecordUpdateInputSchema,
    inputShape: {
      fields: z.array(z.object({ label: z.string().optional(), name: z.string(), value: z.string() })).min(1),
      target: z
        .object({
          displayName: z.string().optional(),
          id: z.string().optional(),
          type: z.enum(['contact', 'company']),
          url: z.string().url().optional(),
        })
        .optional(),
    },
    name: 'preview_record_update',
  },
  {
    description: 'Create a pending update operation; the extension side panel must approve before saving.',
    handler: (input) => {
      const parsed = requestRecordUpdateInputSchema.parse(input);
      return createOperation({ fields: parsed.fields, kind: 'update', target: parsed.target, type: parsed.target?.type || 'contact' });
    },
    inputSchema: requestRecordUpdateInputSchema,
    inputShape: {
      fields: z.array(z.object({ label: z.string().optional(), name: z.string(), value: z.string() })).min(1),
      target: z
        .object({
          displayName: z.string().optional(),
          id: z.string().optional(),
          type: z.enum(['contact', 'company']),
          url: z.string().url().optional(),
        })
        .optional(),
    },
    name: 'request_record_update',
  },
  {
    description: 'Create a pending fill-only operation; it fills visible fields in HubSpot without clicking save.',
    handler: (input) => {
      const parsed = requestRecordFillInputSchema.parse(input);
      return createOperation({ fields: parsed.fields, kind: 'fill-only', target: parsed.target, type: parsed.target?.type || 'contact' });
    },
    inputSchema: requestRecordFillInputSchema,
    inputShape: {
      fields: z.array(z.object({ label: z.string().optional(), name: z.string(), value: z.string() })).min(1),
      target: z
        .object({
          displayName: z.string().optional(),
          id: z.string().optional(),
          type: z.enum(['contact', 'company']),
          url: z.string().url().optional(),
        })
        .optional(),
    },
    name: 'request_record_fill',
  },
  {
    description: 'Create a pending create operation; the extension side panel must approve before saving.',
    handler: (input) => {
      const parsed = requestRecordCreateInputSchema.parse(input);
      return createOperation({ fields: parsed.fields, kind: 'create', type: parsed.type });
    },
    inputSchema: requestRecordCreateInputSchema,
    inputShape: {
      fields: z.array(z.object({ label: z.string().optional(), name: z.string(), value: z.string() })).min(1),
      type: z.enum(['contact', 'company']),
    },
    name: 'request_record_create',
  },
  {
    description: 'Create a pending batch update of up to 25 records; every item runs after side panel approval.',
    handler: (input) => {
      const parsed = requestBatchUpdateInputSchema.parse(input);
      return createOperation({ items: parsed.items, kind: 'batch-update', type: parsed.type });
    },
    inputSchema: requestBatchUpdateInputSchema,
    inputShape: {
      items: z
        .array(
          z.object({
            fields: z.array(z.object({ label: z.string().optional(), name: z.string(), value: z.string() })).min(1),
            target: z.object({
              displayName: z.string().optional(),
              id: z.string().optional(),
              type: z.enum(['contact', 'company']),
              url: z.string().url().optional(),
            }),
          }),
        )
        .min(1)
        .max(25),
      type: z.enum(['contact', 'company']),
    },
    name: 'request_batch_update',
  },
  {
    description: 'Create pending contacts and associate them to a provided/current company when the HubSpot form exposes that field.',
    handler: (input) => {
      const parsed = requestAssociatedContactsCreateInputSchema.parse(input);
      return createOperation({ company: parsed.company, contactCreates: parsed.contacts, kind: 'create-associated-contacts', type: 'contact' });
    },
    inputSchema: requestAssociatedContactsCreateInputSchema,
    inputShape: {
      company: z
        .object({
          displayName: z.string().optional(),
          id: z.string().optional(),
          type: z.enum(['company']),
          url: z.string().url().optional(),
        })
        .optional(),
      contacts: z
        .array(
          z.object({
            fields: z.array(z.object({ label: z.string().optional(), name: z.string(), value: z.string() })).min(1),
          }),
        )
        .min(1)
        .max(25),
    },
    name: 'request_associated_contacts_create',
  },
  {
    description: 'Get one pending, approved, running, rejected, failed, paused, or completed operation.',
    handler: (input) => {
      const { operationId } = getOperationInputSchema.parse(input);
      return { ok: true, operation: getOperation(operationId) };
    },
    inputSchema: getOperationInputSchema,
    inputShape: {
      operationId: z.string().trim().min(1),
    },
    name: 'get_operation',
  },
  {
    description: 'Return local audit history without secrets or full CRM exports.',
    handler: (input) => {
      const { limit = 50 } = getAuditLogInputSchema.parse(input);
      return { audit: getAuditLog(limit), ok: true };
    },
    inputSchema: getAuditLogInputSchema,
    inputShape: {
      limit: z.number().int().positive().max(100).optional(),
    },
    name: 'get_audit_log',
  },
  {
    description: 'Enable or disable Autopilot. When enabled, the extension auto-runs pending writes without per-operation approval.',
    handler: async (input) => {
      const { enabled } = setAutopilotInputSchema.parse(input);
      return { autopilot: await setAutopilot(enabled), ok: true };
    },
    inputSchema: setAutopilotInputSchema,
    inputShape: {
      enabled: z.boolean(),
    },
    name: 'set_autopilot',
  },
];

export const createMcpApp = () => {
  const server = new McpServer({
    name: packageName,
    version: '0.1.0',
  });

  server.registerResource(
    'hubspot-browser-context',
    'hubspot-browser://context',
    {
      description: 'Current HubSpot browser-mediated MCP context.',
      mimeType: 'application/json',
      title: 'HubSpot Browser Context',
    },
    async () => ({
      contents: [
        {
          mimeType: 'application/json',
          text: JSON.stringify(getContext(), null, 2),
          uri: 'hubspot-browser://context',
        },
      ],
    }),
  );

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputShape,
      },
      async (input) => {
        try {
          return createResult(await tool.handler(tool.inputSchema.parse(input ?? {})));
        } catch (error) {
          return createError(error);
        }
      },
    );
  }

  return server;
};
