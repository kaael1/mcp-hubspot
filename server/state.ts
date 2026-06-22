import { randomBytes, randomUUID } from 'node:crypto';

import { getDataFilePath } from './runtime-paths.js';
import { readJsonFile, writeJsonFile } from './store-utils.js';
import { redact } from '../shared/redaction.js';
import type {
  ActivityCreateInput,
  AssociationCreateInput,
  AuditEntry,
  BrowserTask,
  FieldPatch,
  FieldSnapshot,
  Operation,
  PageSnapshot,
  RecordRef,
  RecordType,
} from '../shared/schemas.js';
import { operationSchema, pageSnapshotSchema } from '../shared/schemas.js';

type PairingState = {
  extensionId?: string;
  key: string;
  pairedAt?: string;
  version?: string;
};

type AppState = {
  audit: AuditEntry[];
  latestSnapshot?: PageSnapshot;
  operations: Record<string, Operation>;
  pairedExtension?: {
    extensionId?: string;
    lastSeenAt: string;
    pairedAt: string;
    version?: string;
  };
  settings: {
    autopilot: {
      enabled: boolean;
      enabledAt?: string;
      updatedAt?: string;
    };
  };
  tasks: Record<string, BrowserTask>;
};

const emptyState = (): AppState => ({
  audit: [],
  operations: {},
  settings: {
    autopilot: {
      enabled: false,
    },
  },
  tasks: {},
});

let pairingState: PairingState | null = null;
let appState: AppState = emptyState();
const taskWaiters = new Map<string, Array<(task: BrowserTask) => void>>();
const taskLeaseMs = 60_000;

const now = () => new Date().toISOString();
const pairingPath = () => getDataFilePath('pairing.json');
const statePath = () => getDataFilePath('state.json');

const createPairingKey = () => randomBytes(18).toString('base64url');

const savePairing = async () => {
  if (!pairingState) return;
  await writeJsonFile(pairingPath(), pairingState);
};

const saveState = async () => {
  await writeJsonFile(statePath(), redact(appState));
};

const appendAudit = async (entry: Omit<AuditEntry, 'at' | 'id'>) => {
  appState.audit = [
    {
      ...entry,
      at: now(),
      id: randomUUID(),
    },
    ...appState.audit,
  ].slice(0, 250);
  await saveState();
};

const wakeTaskWaiters = (task: BrowserTask) => {
  const waiters = taskWaiters.get(task.id) || [];
  taskWaiters.delete(task.id);
  for (const resolve of waiters) resolve(task);
};

export const loadRuntimeState = async () => {
  pairingState = await readJsonFile<PairingState | null>(pairingPath(), null);
  if (!pairingState?.key) {
    pairingState = {
      key: createPairingKey(),
    };
    await savePairing();
  }

  appState = await readJsonFile<AppState>(statePath(), emptyState());
  appState.audit ||= [];
  appState.operations ||= {};
  appState.settings ||= emptyState().settings;
  appState.settings.autopilot ||= { enabled: false };
  appState.tasks ||= {};
};

export const getPairingKey = () => {
  if (!pairingState?.key) {
    pairingState = { key: createPairingKey() };
  }
  return pairingState.key;
};

export const verifyPairingKey = (key: string | null | undefined) => Boolean(key && key === getPairingKey());

export const pairExtension = async (input: { extensionId?: string; key: string; version?: string }) => {
  if (!verifyPairingKey(input.key)) {
    throw new Error('Invalid pairing key.');
  }

  const pairedAt = pairingState?.pairedAt || now();
  pairingState = {
    extensionId: input.extensionId,
    key: getPairingKey(),
    pairedAt,
    version: input.version,
  };
  appState.pairedExtension = {
    extensionId: input.extensionId,
    lastSeenAt: now(),
    pairedAt,
    version: input.version,
  };
  await savePairing();
  await appendAudit({ summary: 'Extension paired with local bridge.', type: 'pair' });
  return appState.pairedExtension;
};

export const touchExtension = async () => {
  if (!appState.pairedExtension) return null;
  appState.pairedExtension = {
    ...appState.pairedExtension,
    lastSeenAt: now(),
  };
  await saveState();
  return appState.pairedExtension;
};

export const saveSnapshot = async (snapshot: PageSnapshot) => {
  appState.latestSnapshot = pageSnapshotSchema.parse(redact(snapshot));
  await appendAudit({
    detail: appState.latestSnapshot.url,
    summary: `Captured ${appState.latestSnapshot.recordType || 'HubSpot'} page snapshot.`,
    type: 'snapshot',
  });
  return appState.latestSnapshot;
};

export const getContext = () => ({
  auditCount: appState.audit.length,
  capabilities: {
    canCreateCompanies: Boolean(appState.pairedExtension),
    canCreateContacts: Boolean(appState.pairedExtension),
    canCreateDeals: Boolean(appState.pairedExtension),
    canCreateTickets: Boolean(appState.pairedExtension),
    canCreateTimelineActivities: Boolean(appState.pairedExtension),
    canReadVisibleAssociations: Boolean(appState.latestSnapshot?.associations?.length),
    canReadVisiblePage: Boolean(appState.latestSnapshot),
    canReadVisibleTables: Boolean(appState.latestSnapshot?.tables?.length),
    canReadVisibleTimeline: Boolean(appState.latestSnapshot?.timeline?.length),
    canRunBrowserTasks: Boolean(appState.pairedExtension),
    canUseCustomObjectsByObjectId: Boolean(appState.pairedExtension),
    canUpdateRecords: Boolean(appState.pairedExtension),
    supportedRecordTypes: ['contact', 'company', 'deal', 'ticket', 'custom'],
  },
  latestSnapshot: appState.latestSnapshot || null,
  pairedExtension: appState.pairedExtension || null,
  pendingOperations: Object.values(appState.operations).filter((operation) =>
    ['pending', 'approved', 'running', 'paused'].includes(operation.status),
  ),
  pendingTasks: Object.values(appState.tasks).filter((task) => ['pending', 'running'].includes(task.status)),
  settings: appState.settings,
});

export const createBrowserTask = async (type: BrowserTask['type'], input: unknown) => {
  await failStaleRunningTasks();
  const task: BrowserTask = {
    createdAt: now(),
    id: randomUUID(),
    input: redact(input),
    status: 'pending',
    type,
    updatedAt: now(),
  };
  appState.tasks[task.id] = task;
  await appendAudit({ operationId: task.id, summary: `Queued browser task ${type}.`, type: 'task' });
  return task;
};

export const getBrowserTask = (id: string) => appState.tasks[id] || null;

const failStaleRunningTasks = async () => {
  const cutoff = Date.now() - taskLeaseMs;
  const staleTasks = Object.values(appState.tasks).filter((task) => {
    if (task.status !== 'running') return false;
    const updatedAt = Date.parse(task.updatedAt || task.startedAt || task.createdAt);
    return Number.isFinite(updatedAt) && updatedAt < cutoff;
  });

  for (const task of staleTasks) {
    const failed: BrowserTask = {
      ...task,
      completedAt: now(),
      error: 'Browser task timed out while waiting for the extension to return a result.',
      status: 'failed',
      updatedAt: now(),
    };
    appState.tasks[task.id] = failed;
    wakeTaskWaiters(failed);
    await appendAudit({
      detail: failed.error,
      operationId: task.id,
      summary: `Browser task ${task.type} failed.`,
      type: 'task',
    });
  }
};

export const claimNextTask = async () => {
  await failStaleRunningTasks();
  const task = Object.values(appState.tasks)
    .filter((candidate) => candidate.status === 'pending')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

  if (!task) return null;

  const nextTask: BrowserTask = {
    ...task,
    startedAt: now(),
    status: 'running',
    updatedAt: now(),
  };
  appState.tasks[nextTask.id] = nextTask;
  await touchExtension();
  return nextTask;
};

export const completeTask = async (id: string, result: { error?: string; result?: unknown; status: 'failed' | 'succeeded' }) => {
  const task = appState.tasks[id];
  if (!task) throw new Error(`Unknown browser task: ${id}`);

  const completed: BrowserTask = {
    ...task,
    completedAt: now(),
    error: result.error,
    result: redact(result.result),
    status: result.status,
    updatedAt: now(),
  };
  appState.tasks[id] = completed;
  await appendAudit({
    detail: result.error,
    operationId: id,
    summary: `Browser task ${task.type} ${result.status}.`,
    type: 'task',
  });
  wakeTaskWaiters(completed);
  return completed;
};

export const waitForTask = async (id: string, timeoutMs = 45_000) => {
  const task = appState.tasks[id];
  if (!task) throw new Error(`Unknown browser task: ${id}`);
  if (task.status === 'succeeded' || task.status === 'failed') return task;

  return new Promise<BrowserTask>((resolve) => {
    const timeout = setTimeout(() => {
      const latest = appState.tasks[id];
      resolve(latest || task);
    }, timeoutMs);

    const waiters = taskWaiters.get(id) || [];
    waiters.push((completed) => {
      clearTimeout(timeout);
      resolve(completed);
    });
    taskWaiters.set(id, waiters);
  });
};

const createBeforeAfterPreview = (fields: FieldPatch[]): { after: FieldSnapshot[]; before: FieldSnapshot[] } => ({
  after: fields.map((field) => ({
    label: field.label || field.name,
    name: field.name,
    value: field.value,
  })),
  before: fields.map((field) => {
    const current = appState.latestSnapshot?.fields.find(
      (snapshotField) =>
        snapshotField.name?.toLowerCase() === field.name.toLowerCase() ||
        snapshotField.label.toLowerCase() === (field.label || field.name).toLowerCase(),
    );

    return {
      label: field.label || field.name,
      name: field.name,
      value: current?.value || '',
    };
  }),
});

export const previewUpdate = (input: { fields: FieldPatch[]; target?: RecordRef }) => ({
  preview: createBeforeAfterPreview(input.fields),
  target: input.target || null,
});

export const createOperation = async (
  input:
    | { fields: FieldPatch[]; kind: 'create'; objectId?: string; objectLabel?: string; type: RecordType }
    | { fields: FieldPatch[]; kind: 'update'; objectId?: string; objectLabel?: string; target?: RecordRef; type: RecordType }
    | { fields: FieldPatch[]; kind: 'fill-only'; objectId?: string; objectLabel?: string; target?: RecordRef; type: RecordType }
    | { company?: RecordRef; contactCreates: Array<{ fields: FieldPatch[] }>; kind: 'create-associated-contacts'; type: 'contact' }
    | { items: Array<{ fields: FieldPatch[]; target: RecordRef }>; kind: 'batch-update'; objectId?: string; objectLabel?: string; type: RecordType }
    | { activity: ActivityCreateInput; kind: 'create-activity'; type: RecordType }
    | { association: AssociationCreateInput; kind: 'associate-record'; type: RecordType },
) => {
  const createdAt = now();
  const objectId =
    'objectId' in input
      ? input.objectId
      : 'target' in input
        ? input.target?.objectId
        : 'activity' in input
          ? input.activity.target?.objectId
          : 'association' in input
            ? input.association.from?.objectId
            : undefined;
  const objectLabel =
    'objectLabel' in input
      ? input.objectLabel
      : 'target' in input
        ? input.target?.objectLabel
        : 'activity' in input
          ? input.activity.target?.objectLabel
          : 'association' in input
            ? input.association.from?.objectLabel
            : undefined;
  const operation: Operation = operationSchema.parse({
    activity: 'activity' in input ? input.activity : undefined,
    association: 'association' in input ? input.association : undefined,
    createdAt,
    company: 'company' in input ? input.company : undefined,
    contactCreates: 'contactCreates' in input ? input.contactCreates : undefined,
    fields: 'fields' in input ? input.fields : undefined,
    id: randomUUID(),
    items: 'items' in input ? input.items : undefined,
    kind: input.kind,
    objectId,
    objectLabel,
    preview: 'fields' in input ? createBeforeAfterPreview(input.fields) : undefined,
    risk: input.kind === 'batch-update' ? 'batch' : 'write',
    status: 'pending',
    summary:
      input.kind === 'batch-update'
        ? `Batch update ${input.items.length} ${input.type} record(s).`
        : input.kind === 'create-associated-contacts'
          ? `Create ${input.contactCreates.length} associated contact(s).`
          : input.kind === 'create-activity'
            ? `Create ${input.activity.type} activity.`
            : input.kind === 'associate-record'
              ? `Associate ${input.association.to.displayName || input.association.to.id || input.association.to.type}.`
              : `${input.kind === 'create' ? 'Create' : input.kind === 'fill-only' ? 'Fill' : 'Update'} ${input.type} record.`,
    target: 'target' in input ? input.target : undefined,
    type: input.type,
    updatedAt: createdAt,
  });

  appState.operations[operation.id] = operation;
  await appendAudit({ operationId: operation.id, summary: operation.summary, type: 'operation' });
  return operation;
};

export const getOperation = (id: string) => appState.operations[id] || null;

export const approveOperation = async (id: string) => {
  const operation = getOperation(id);
  if (!operation) throw new Error(`Unknown operation: ${id}`);
  if (operation.status !== 'pending' && operation.status !== 'paused') {
    throw new Error(`Operation ${id} is not awaiting approval.`);
  }

  const approved: Operation = {
    ...operation,
    approvedAt: now(),
    status: 'approved',
    updatedAt: now(),
  };
  appState.operations[id] = approved;
  await appendAudit({ operationId: id, summary: `Approved operation ${id}.`, type: 'approval' });
  return approved;
};

export const rejectOperation = async (id: string) => {
  const operation = getOperation(id);
  if (!operation) throw new Error(`Unknown operation: ${id}`);
  const rejected: Operation = {
    ...operation,
    rejectedAt: now(),
    status: 'rejected',
    updatedAt: now(),
  };
  appState.operations[id] = rejected;
  await appendAudit({ operationId: id, summary: `Rejected operation ${id}.`, type: 'rejection' });
  return rejected;
};

export const markOperationRunning = async (id: string) => {
  const operation = getOperation(id);
  if (!operation) throw new Error(`Unknown operation: ${id}`);
  const running: Operation = {
    ...operation,
    status: 'running',
    updatedAt: now(),
  };
  appState.operations[id] = running;
  await saveState();
  return running;
};

export const completeOperation = async (
  id: string,
  result: { error?: string; itemResults?: Operation['itemResults']; result?: unknown; status: 'failed' | 'paused' | 'succeeded' },
) => {
  const operation = getOperation(id);
  if (!operation) throw new Error(`Unknown operation: ${id}`);
  const completed: Operation = {
    ...operation,
    completedAt: result.status === 'succeeded' || result.status === 'failed' ? now() : operation.completedAt,
    error: result.error,
    itemResults: result.itemResults,
    result: redact(result.result),
    status: result.status,
    updatedAt: now(),
  };
  appState.operations[id] = completed;
  await appendAudit({
    detail: result.error,
    operationId: id,
    summary: `Operation ${id} ${result.status}.`,
    type: 'result',
  });
  return completed;
};

export const getAuditLog = (limit = 50) => appState.audit.slice(0, limit);

export const setAutopilot = async (enabled: boolean) => {
  appState.settings = {
    ...appState.settings,
    autopilot: {
      enabled,
      enabledAt: enabled ? appState.settings.autopilot.enabledAt || now() : undefined,
      updatedAt: now(),
    },
  };
  await appendAudit({
    summary: `Autopilot ${enabled ? 'enabled' : 'disabled'}.`,
    type: 'operation',
  });
  return appState.settings.autopilot;
};
