import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from '../shared/errors.js';

type CursorFieldType = 'date' | 'number' | 'string';

export type CursorFieldSchema = {
  key: string;
  direction: 'asc' | 'desc';
  type: CursorFieldType;
};

export const DEFAULT_CURSOR_SCHEMA: CursorFieldSchema[] = [
  { key: 'createdAt', direction: 'desc', type: 'date' },
  { key: 'id', direction: 'desc', type: 'string' },
];

export class PaginationError extends Error {
  status: number;
  errorCode: ErrorCode;
  details?: Record<string, unknown>;

  constructor(status: number, errorCode: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_LIMIT = 100;

export function parseLimit(raw: unknown, opts?: { defaultLimit?: number; maxLimit?: number }): number {
  const def = opts?.defaultLimit ?? DEFAULT_LIMIT;
  const max = opts?.maxLimit ?? DEFAULT_MAX_LIMIT;
  if (raw === undefined || raw === null || raw === '') {
    return def;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PaginationError(400, ERROR_CODES.INVALID_LIMIT, ERROR_MESSAGES.INVALID_LIMIT, { limit: raw });
  }
  const limit = Math.floor(parsed);
  if (limit > max) {
    throw new PaginationError(400, ERROR_CODES.INVALID_LIMIT, `Limit cannot exceed ${max}`, { limit, max });
  }
  return limit;
}

export function safeDecodeCursor(
  cursor: unknown,
  schema: CursorFieldSchema[] = DEFAULT_CURSOR_SCHEMA
): Record<string, unknown> | null {
  if (cursor === undefined || cursor === null) return null;
  if (typeof cursor !== 'string') {
    throw new PaginationError(400, ERROR_CODES.BAD_REQUEST, 'Cursor must be a string');
  }
  if (cursor.trim() === '') {
    return null;
  }
  try {
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    const padded = normalized + '='.repeat(pad);
    const raw = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Cursor payload is not an object');
    }
    const result: Record<string, unknown> = {};
    for (const field of schema) {
      if (!(field.key in parsed)) {
        throw new Error(`Cursor missing field ${field.key}`);
      }
      const value = parsed[field.key];
      if (field.type === 'date') {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new Error(`Invalid date for ${field.key}`);
        result[field.key] = date;
      } else if (field.type === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) throw new Error(`Invalid number for ${field.key}`);
        result[field.key] = num;
      } else {
        result[field.key] = String(value);
      }
    }
    return result;
  } catch (err) {
    const error = err as Error;
    throw new PaginationError(400, ERROR_CODES.BAD_REQUEST, 'Invalid cursor', { cause: error?.message });
  }
}

export function encodeCursorFromItem(
  item: Record<string, unknown>,
  schema: CursorFieldSchema[] = DEFAULT_CURSOR_SCHEMA
): string | null {
  if (!item) return null;
  const payload: Record<string, unknown> = {};
  for (const field of schema) {
    const value = item[field.key];
    if (value === undefined || value === null) {
      return null;
    }
    if (field.type === 'date') {
      if (value instanceof Date) {
        payload[field.key] = value.toISOString();
      } else if (typeof value === 'string' || typeof value === 'number') {
        payload[field.key] = new Date(value).toISOString();
      } else {
        return null;
      }
    } else {
      payload[field.key] = value;
    }
  }
  const raw = JSON.stringify(payload);
  return Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function buildCursorFilter(schema: CursorFieldSchema[], cursor: Record<string, unknown>) {
  if (!cursor) return null;
  const build = (index: number): Record<string, unknown> => {
    const field = schema[index];
    if (!field) return {};
    const compareOp = field.direction === 'desc' ? 'lt' : 'gt';
    const equalsOp = 'equals';
    const comparator = { [field.key]: { [compareOp]: cursor[field.key] } };
    if (index === schema.length - 1) {
      return comparator;
    }
    return {
      OR: [
        comparator,
        {
          AND: [{ [field.key]: { [equalsOp]: cursor[field.key] } }, build(index + 1)],
        },
      ],
    };
  };
  return build(0);
}

export function mergeCursorWhere(baseWhere: Record<string, unknown>, cursorFilter: Record<string, unknown> | null) {
  if (!cursorFilter) return baseWhere;
  if (!baseWhere || Object.keys(baseWhere).length === 0) return cursorFilter;
  return { AND: [baseWhere, cursorFilter] };
}
