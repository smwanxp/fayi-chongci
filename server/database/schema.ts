/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgSequence, pgTable, text, uniqueIndex, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const fayiDataUploadChunksIdSeq = pgSequence("fayi_data_upload_chunks_id_seq");

export const fayiStudentRemarksIdSeq = pgSequence("fayi_student_remarks_id_seq");

export const fayiUserDataIdSeq = pgSequence("fayi_user_data_id_seq");

export const fayiStudentRemarks = pgTable("fayi_student_remarks", {
  id: bigint("id", { mode: 'number' }).primaryKey().default(sql`nextval('fayi_student_remarks_id_seq'::regclass)`),
  adminUserId: varchar("admin_user_id", { length: 128 }).notNull(),
  studentUserId: varchar("student_user_id", { length: 128 }).notNull(),
  remark: text("remark").notNull(),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("fayi_student_remarks_admin_user_id_student_user_id_key").on(table.adminUserId, table.studentUserId),
  index("fayi_student_remarks_admin_user_id_idx").on(table.adminUserId),
]);

export const fayiDataUploadChunks = pgTable("fayi_data_upload_chunks", {
  id: bigint("id", { mode: 'number' }).primaryKey().default(sql`nextval('fayi_data_upload_chunks_id_seq'::regclass)`),
  ownerUserId: varchar("owner_user_id", { length: 128 }).notNull(),
  uploadId: varchar("upload_id", { length: 64 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkData: text("chunk_data").notNull(),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("fayi_data_upload_chunks_owner_user_id_upload_id_chunk_index_key").on(table.ownerUserId, table.uploadId, table.chunkIndex),
  index("fayi_data_upload_chunks_lookup_idx").on(table.ownerUserId, table.uploadId, table.chunkIndex),
]);

export const fayiUserData = pgTable("fayi_user_data", {
  id: bigint("id", { mode: 'number' }).primaryKey().default(sql`nextval('fayi_user_data_id_seq'::regclass)`),
  ownerUserId: varchar("owner_user_id", { length: 128 }).notNull().unique(),
  payload: jsonb("payload").notNull(),
  contentRevision: integer("content_revision").notNull().default(0),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("fayi_user_data_owner_user_id_key").on(table.ownerUserId),
  index("fayi_user_data_updated_at_idx").on(table.updatedAt),
]);

// table aliases
export const fayiDataUploadChunksTable = fayiDataUploadChunks;
export const fayiStudentRemarksTable = fayiStudentRemarks;
export const fayiUserDataTable = fayiUserData;
