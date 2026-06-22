const sensitiveKeyPattern = /authorization|bearer|cookie|csrf|jwt|password|secret|session|token/i;
const jwtPattern = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._-]+\b/gi;

export const redactString = (value: string) =>
  value.replace(bearerPattern, '[REDACTED_BEARER]').replace(jwtPattern, '[REDACTED_JWT]');

export const redact = <T>(value: T): T => {
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redact(item)) as T;
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sensitiveKeyPattern.test(key) ? '[REDACTED]' : redact(nestedValue),
    ]),
  ) as T;
};
