/**
 * The misconception map of a student. The pilot core ships an in-memory
 * implementation; the PostgreSQL one will implement the same interface.
 * Both identifiers always come from the verified session, never from the model.
 */
export interface MisconceptionRecord {
  code: string;
  seenCount: number;
  status: 'new' | 'in_progress' | 'fixed';
}

export interface MisconceptionStore {
  record(orgId: string, studentId: string, code: string): Promise<void>;
  list(orgId: string, studentId: string): Promise<MisconceptionRecord[]>;
}

export class InMemoryMisconceptionStore implements MisconceptionStore {
  private readonly data = new Map<string, Map<string, MisconceptionRecord>>();

  private bucket(orgId: string, studentId: string): Map<string, MisconceptionRecord> {
    const key = `${orgId}:${studentId}`;
    let bucket = this.data.get(key);
    if (!bucket) {
      bucket = new Map();
      this.data.set(key, bucket);
    }
    return bucket;
  }

  async record(orgId: string, studentId: string, code: string): Promise<void> {
    const bucket = this.bucket(orgId, studentId);
    const existing = bucket.get(code);
    if (existing) {
      existing.seenCount += 1;
      existing.status = 'in_progress';
    } else {
      bucket.set(code, { code, seenCount: 1, status: 'new' });
    }
  }

  async list(orgId: string, studentId: string): Promise<MisconceptionRecord[]> {
    return [...this.bucket(orgId, studentId).values()].map((r) => ({ ...r }));
  }
}
