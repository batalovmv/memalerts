export interface AuditLog {
  id: string;
  actorId: string | null;
  action: string;
  entityId?: string | null;
  entityType?: string | null;
  data?: Record<string, unknown> | null;
  createdAt: string;
}
