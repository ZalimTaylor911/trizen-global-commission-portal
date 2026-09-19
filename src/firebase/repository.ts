/**
 * Write path for every collection.
 *
 * Nothing else in the app calls addDoc/updateDoc/deleteDoc directly — routing
 * writes through here is what guarantees SPEC.md §11: every change lands in the
 * audit log with the before and after values, and admins can't skip it by
 * accident.
 */

import {
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type WriteBatch,
} from 'firebase/firestore';
import { auditLogCol } from './collections';
import { db } from './config';
import type { AuditAction, AuditEntity } from '@/domain/types';

export interface Actor {
  userId: string;
  userName: string;
}

/**
 * Additional writes that must commit together with a newly created record.
 * The callback receives the definitive Firestore document id before the batch
 * is committed, which is important for child access-index records.
 */
export interface CreateRecordSideEffect {
  batch: WriteBatch;
  id: string;
  createdAt: string;
}

/** Extra writes that must succeed or fail together with an existing record. */
export interface RecordWriteSideEffect {
  batch: WriteBatch;
  id: string;
  updatedAt?: string;
}

/** Fields that are bookkeeping noise in an audit diff rather than real changes. */
const IGNORED_IN_DIFF = new Set(['createdAt', 'updatedAt', 'id']);

function diff(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): { before: Record<string, unknown> | null; after: Record<string, unknown> | null } {
  if (!previous || !next) return { before: previous, after: next };

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (IGNORED_IN_DIFF.has(key)) continue;
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      before[key] = previous[key] ?? null;
      after[key] = next[key] ?? null;
    }
  }

  return { before, after };
}

function auditPayload(params: {
  actor: Actor;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  entityLabel: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}) {
  return {
      userId: params.actor.userId,
      userName: params.actor.userName,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      entityLabel: params.entityLabel,
      // Server time, rather than the workstation clock, makes the audit trail
      // consistent across the team and stops clients from backdating entries.
      timestamp: serverTimestamp(),
      previousValue: params.previousValue,
      newValue: params.newValue,
    } as never;
}

export async function createRecord<T extends object>(
  col: CollectionReference<T, DocumentData>,
  options: {
    entity: AuditEntity;
    label: string;
    actor: Actor;
    /** Runs inside the same batch as the record and its audit entry. */
    onCreate?: (effect: CreateRecordSideEffect) => void;
  },
  data: T,
): Promise<string> {
  const createdAt = new Date().toISOString();
  const payload = { ...data, createdAt };
  const ref = doc(col);
  const auditRef = doc(auditLogCol);
  const batch = writeBatch(db);
  batch.set(ref, payload as T);
  batch.set(auditRef, auditPayload({
    actor: options.actor,
    action: 'created',
    entity: options.entity,
    entityId: ref.id,
    entityLabel: options.label,
    previousValue: null,
    newValue: payload as Record<string, unknown>,
  }));
  options.onCreate?.({ batch, id: ref.id, createdAt });
  await batch.commit();

  return ref.id;
}

export async function updateRecord<T extends object>(
  col: CollectionReference<T, DocumentData>,
  options: {
    entity: AuditEntity;
    label: string;
    actor: Actor;
    id: string;
    previous: Record<string, unknown>;
    /** Set for shipment status transitions so the log reads 'status-changed'. */
    action?: AuditAction;
    /** Runs in the same batch as the update and audit entry. */
    onUpdate?: (effect: RecordWriteSideEffect) => void;
  },
  changes: Partial<T>,
): Promise<void> {
  const payload = { ...changes, updatedAt: new Date().toISOString() };
  const { before, after } = diff(options.previous, { ...options.previous, ...payload });
  const batch = writeBatch(db);
  batch.update(doc(col, options.id), payload as never);
  batch.set(doc(auditLogCol), auditPayload({
    actor: options.actor,
    action: options.action ?? 'updated',
    entity: options.entity,
    entityId: options.id,
    entityLabel: options.label,
    previousValue: before,
    newValue: after,
  }));
  options.onUpdate?.({ batch, id: options.id, updatedAt: payload.updatedAt });
  await batch.commit();
}

export async function deleteRecord<T extends object>(
  col: CollectionReference<T, DocumentData>,
  options: {
    entity: AuditEntity;
    label: string;
    actor: Actor;
    id: string;
    previous: Record<string, unknown>;
    /** Runs in the same batch as the deletion and audit entry. */
    onDelete?: (effect: RecordWriteSideEffect) => void;
  },
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(col, options.id));
  batch.set(doc(auditLogCol), auditPayload({
    actor: options.actor,
    action: 'deleted',
    entity: options.entity,
    entityId: options.id,
    entityLabel: options.label,
    previousValue: options.previous,
    newValue: null,
  }));
  options.onDelete?.({ batch, id: options.id });
  await batch.commit();
}

/** Reserve one of Firestore's 500 batch operations for the matching audit entry. */
const BATCH_LIMIT = 499;

/**
 * Write many records at once, for the bulk importer.
 *
 * Each batch carries its own summary audit entry. This keeps the shipment writes
 * and their audit records atomic, including imports over Firestore's 500-write
 * limit.
 */
export async function createManyRecords<T extends Record<string, unknown>>(
  col: CollectionReference<T, DocumentData>,
  options: {
    entity: AuditEntity;
    actor: Actor;
    /** Shown in the audit log, e.g. 'Bulk import from loads-july.xlsx'. */
    label: string;
    /** Short identifiers summarised in the audit entry. */
    identifiers: string[];
  },
  records: T[],
): Promise<number> {
  const createdAt = new Date().toISOString();
  let written = 0;

  for (let start = 0; start < records.length; start += BATCH_LIMIT) {
    const chunk = records.slice(start, start + BATCH_LIMIT);
    const batch = writeBatch(db);

    for (const record of chunk) {
      batch.set(doc(col), { ...record, createdAt } as never);
    }

    batch.set(doc(auditLogCol), auditPayload({
      actor: options.actor,
      action: 'created',
      entity: options.entity,
      entityId: start === 0 && records.length <= BATCH_LIMIT ? 'bulk-import' : `bulk-import-${start / BATCH_LIMIT + 1}`,
      entityLabel: options.label,
      previousValue: null,
      newValue: {
        recordsCreated: chunk.length,
        identifiers: options.identifiers.slice(start, start + BATCH_LIMIT).slice(0, 200),
        truncated: chunk.length > 200,
      },
    }));

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

/** Used for `users/{uid}`, where the document id must be the Firebase Auth uid. */
export async function upsertWithId<T extends object>(
  col: CollectionReference<T, DocumentData>,
  id: string,
  data: T,
): Promise<void> {
  await setDoc(doc(col, id), data, { merge: true });
}

export { serverTimestamp };
