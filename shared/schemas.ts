import { z } from 'zod';

export const recordTypeSchema = z.enum(['contact', 'company', 'deal', 'ticket', 'custom']);
export const activityTypeSchema = z.enum(['note', 'task', 'call', 'meeting', 'email']);
export const operationStatusSchema = z.enum([
  'pending',
  'approved',
  'running',
  'succeeded',
  'failed',
  'rejected',
  'paused',
  'skipped',
]);
export const taskStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed']);
export const taskTypeSchema = z.enum(['capture_snapshot', 'search_records', 'open_record', 'execute_operation']);

export const fieldPatchSchema = z.object({
  label: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  value: z.string(),
});

export const fieldSnapshotSchema = z.object({
  label: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  section: z.string().trim().min(1).optional(),
  value: z.string(),
});

export const tableSnapshotSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.string())),
  title: z.string().optional(),
});

export const associationSnapshotSchema = z.object({
  displayName: z.string(),
  objectId: z.string().optional(),
  recordId: z.string().optional(),
  type: recordTypeSchema.optional(),
  url: z.string().url().optional(),
});

export const recordRefSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
  objectId: z.string().trim().min(1).optional(),
  objectLabel: z.string().trim().min(1).optional(),
  type: recordTypeSchema,
  url: z.string().url().optional(),
});

export const timelineItemSnapshotSchema = z.object({
  actor: z.string().optional(),
  at: z.string().optional(),
  body: z.string().optional(),
  title: z.string(),
  type: activityTypeSchema.optional(),
  url: z.string().url().optional(),
});

export const pageSnapshotSchema = z.object({
  associations: z.array(associationSnapshotSchema).optional(),
  capturedAt: z.string().trim().min(1),
  displayName: z.string().trim().min(1).optional(),
  fields: z.array(fieldSnapshotSchema),
  recordId: z.string().trim().min(1).optional(),
  recordType: recordTypeSchema.optional(),
  tables: z.array(tableSnapshotSchema).optional(),
  timeline: z.array(timelineItemSnapshotSchema).optional(),
  title: z.string(),
  url: z.string().url(),
});

export const searchResultSchema = z.object({
  description: z.string().optional(),
  displayName: z.string().trim().min(1),
  id: z.string().trim().min(1).optional(),
  objectId: z.string().trim().min(1).optional(),
  type: recordTypeSchema,
  url: z.string().url().optional(),
});

export const searchRecordsInputSchema = z.object({
  limit: z.number().int().positive().max(25).optional(),
  objectId: z.string().trim().min(1).optional(),
  objectLabel: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1),
  timeoutMs: z.number().int().min(0).max(60_000).optional(),
  type: recordTypeSchema,
});

export const openRecordInputSchema = z
  .object({
    objectId: z.string().trim().min(1).optional(),
    objectLabel: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1).optional(),
    record: recordRefSchema.optional(),
    timeoutMs: z.number().int().min(0).max(60_000).optional(),
    type: recordTypeSchema.optional(),
    url: z.string().url().optional(),
  })
  .refine((value) => Boolean(value.url || value.record || value.query), {
    message: 'Provide url, record, or query.',
  });

export const previewRecordUpdateInputSchema = z.object({
  fields: z.array(fieldPatchSchema).min(1),
  target: recordRefSchema.optional(),
});

export const requestRecordUpdateInputSchema = previewRecordUpdateInputSchema;
export const requestRecordFillInputSchema = previewRecordUpdateInputSchema;

export const requestRecordCreateInputSchema = z.object({
  fields: z.array(fieldPatchSchema).min(1),
  objectId: z.string().trim().min(1).optional(),
  objectLabel: z.string().trim().min(1).optional(),
  type: recordTypeSchema,
});

export const batchUpdateItemSchema = z.object({
  fields: z.array(fieldPatchSchema).min(1),
  target: recordRefSchema,
});

export const contactCreateItemSchema = z.object({
  fields: z.array(fieldPatchSchema).min(1),
});

export const requestBatchUpdateInputSchema = z.object({
  items: z.array(batchUpdateItemSchema).min(1).max(25),
  objectId: z.string().trim().min(1).optional(),
  objectLabel: z.string().trim().min(1).optional(),
  type: recordTypeSchema,
});

export const requestAssociatedContactsCreateInputSchema = z.object({
  company: recordRefSchema.optional(),
  contacts: z.array(contactCreateItemSchema).min(1).max(25),
});

export const activityCreateInputSchema = z
  .object({
    body: z.string().optional(),
    dueDate: z.string().optional(),
    fields: z.array(fieldPatchSchema).optional(),
    target: recordRefSchema.optional(),
    title: z.string().optional(),
    type: activityTypeSchema,
  })
  .refine((value) => Boolean(value.body || value.title || value.fields?.length), {
    message: 'Provide title, body, or fields for the activity.',
  });

export const requestTimelineActivityCreateInputSchema = activityCreateInputSchema;

export const associationCreateInputSchema = z.object({
  from: recordRefSchema.optional(),
  label: z.string().trim().min(1).optional(),
  to: recordRefSchema,
});

export const requestAssociationCreateInputSchema = associationCreateInputSchema;

export const getOperationInputSchema = z.object({
  operationId: z.string().trim().min(1),
});

export const getAuditLogInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

export const browserTaskInputSchema = z.object({
  taskId: z.string().trim().min(1),
});

export const browserTaskTimeoutInputSchema = z.object({
  timeoutMs: z.number().int().min(0).max(60_000).optional(),
});

export const autopilotSettingsSchema = z.object({
  enabled: z.boolean(),
  enabledAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const setAutopilotInputSchema = z.object({
  enabled: z.boolean(),
});

export const operationItemResultSchema = z.object({
  error: z.string().optional(),
  record: recordRefSchema.optional(),
  status: operationStatusSchema,
});

export const operationSchema = z.object({
  approvedAt: z.string().optional(),
  activity: activityCreateInputSchema.optional(),
  association: associationCreateInputSchema.optional(),
  completedAt: z.string().optional(),
  createdAt: z.string(),
  error: z.string().optional(),
  fields: z.array(fieldPatchSchema).optional(),
  company: recordRefSchema.optional(),
  contactCreates: z.array(contactCreateItemSchema).optional(),
  id: z.string().trim().min(1),
  items: z.array(batchUpdateItemSchema).optional(),
  itemResults: z.array(operationItemResultSchema).optional(),
  kind: z.enum([
    'create',
    'update',
    'batch-update',
    'fill-only',
    'create-associated-contacts',
    'create-activity',
    'associate-record',
  ]),
  objectId: z.string().trim().min(1).optional(),
  objectLabel: z.string().trim().min(1).optional(),
  preview: z
    .object({
      after: z.array(fieldSnapshotSchema),
      before: z.array(fieldSnapshotSchema),
    })
    .optional(),
  rejectedAt: z.string().optional(),
  result: z.unknown().optional(),
  risk: z.enum(['write', 'batch']),
  status: operationStatusSchema,
  summary: z.string(),
  target: recordRefSchema.optional(),
  type: recordTypeSchema,
  updatedAt: z.string(),
});

export const auditEntrySchema = z.object({
  at: z.string(),
  detail: z.string().optional(),
  id: z.string().trim().min(1),
  operationId: z.string().trim().min(1).optional(),
  summary: z.string(),
  type: z.enum(['pair', 'snapshot', 'task', 'operation', 'approval', 'rejection', 'result']),
});

export const browserTaskSchema = z.object({
  completedAt: z.string().optional(),
  createdAt: z.string(),
  error: z.string().optional(),
  id: z.string().trim().min(1),
  input: z.unknown(),
  result: z.unknown().optional(),
  startedAt: z.string().optional(),
  status: taskStatusSchema,
  type: taskTypeSchema,
  updatedAt: z.string(),
});

export const pairRequestSchema = z.object({
  extensionId: z.string().optional(),
  key: z.string().trim().min(8),
  version: z.string().optional(),
});

export const taskResultSchema = z.object({
  error: z.string().optional(),
  result: z.unknown().optional(),
  status: z.enum(['succeeded', 'failed']),
});

export const operationResultSchema = z.object({
  error: z.string().optional(),
  itemResults: z.array(operationItemResultSchema).optional(),
  result: z.unknown().optional(),
  status: z.enum(['succeeded', 'failed', 'paused']),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type ActivityCreateInput = z.infer<typeof activityCreateInputSchema>;
export type ActivityType = z.infer<typeof activityTypeSchema>;
export type AssociationCreateInput = z.infer<typeof associationCreateInputSchema>;
export type AssociationSnapshot = z.infer<typeof associationSnapshotSchema>;
export type BatchUpdateItem = z.infer<typeof batchUpdateItemSchema>;
export type ContactCreateItem = z.infer<typeof contactCreateItemSchema>;
export type BrowserTask = z.infer<typeof browserTaskSchema>;
export type FieldPatch = z.infer<typeof fieldPatchSchema>;
export type FieldSnapshot = z.infer<typeof fieldSnapshotSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type OperationStatus = z.infer<typeof operationStatusSchema>;
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;
export type RecordRef = z.infer<typeof recordRefSchema>;
export type RecordType = z.infer<typeof recordTypeSchema>;
export type SearchRecordsInput = z.infer<typeof searchRecordsInputSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type TableSnapshot = z.infer<typeof tableSnapshotSchema>;
export type TimelineItemSnapshot = z.infer<typeof timelineItemSnapshotSchema>;
