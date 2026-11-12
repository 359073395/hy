import { sql } from "drizzle-orm";
import {
    pgTable, serial, timestamp, varchar, text, uuid, boolean, integer, jsonb, index, uniqueIndex
} from "drizzle-orm/pg-core"

// ────────────────────────────────────────────────────────────────
// 系统表（必须保留，禁止删除）
export const healthCheck = pgTable("health_check", {
    id: serial().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────
// 用户（令牌门禁：姓名 / 令牌哈希 / 角色 / 员工级别 / 状态）
export const users = pgTable(
    "users",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        name: varchar("name", { length: 128 }).notNull(),
        tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
        role: varchar("role", { length: 24 }).notNull().default("employee"), // super_admin | admin | employee
        tier: varchar("tier", { length: 8 }).notNull().default("M2"),        // employee 级别：M2 | M4 | M6
        status: varchar("status", { length: 16 }).notNull().default("active"), // active | disabled
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp("updated_at", { withTimezone: true }),
    },
    (table) => [
        index("users_role_idx").on(table.role),
        index("users_tier_idx").on(table.tier),
        index("users_status_idx").on(table.status),
    ]
);

// ────────────────────────────────────────────────────────────────
// 会话（登录后签发，用于鉴权；停用用户即失效）
export const sessions = pgTable(
    "sessions",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        index("sessions_user_id_idx").on(table.userId),
        index("sessions_expires_idx").on(table.expiresAt),
    ]
);

// ────────────────────────────────────────────────────────────────
// 章节（8 模块 + 附录；is_public 表示对所有人可见，如 M7/M8/附录）
export const chapters = pgTable(
    "chapters",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        module: varchar("module", { length: 16 }).notNull(),     // M1..M8 | APPENDIX
        sectionNo: varchar("section_no", { length: 16 }).notNull(), // 如 3.12
        title: varchar("title", { length: 255 }).notNull(),
        sortOrder: integer("sort_order").notNull().default(0),
        isPublic: boolean("is_public").notNull().default(false), // M7/M8/附录 = true
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp("updated_at", { withTimezone: true }),
    },
    (table) => [
        index("chapters_module_idx").on(table.module),
        index("chapters_sort_idx").on(table.sortOrder),
    ]
);

// ────────────────────────────────────────────────────────────────
// 正文区块（章节 HTML 正文，一个章节一条）
export const contentBlocks = pgTable(
    "content_blocks",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        chapterId: uuid("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
        html: text("html").notNull(),
        version: integer("version").notNull().default(1),
        updatedBy: uuid("updated_by").references(() => users.id),
        updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("content_blocks_chapter_idx").on(table.chapterId),
    ]
);

// ────────────────────────────────────────────────────────────────
// 内容版本快照（编辑保存时生成，可回滚）
export const contentSnapshots = pgTable(
    "content_snapshots",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        contentBlockId: uuid("content_block_id").notNull().references(() => contentBlocks.id, { onDelete: "cascade" }),
        version: integer("version").notNull(),
        html: text("html").notNull(),
        createdBy: uuid("created_by").references(() => users.id),
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        index("content_snapshots_block_idx").on(table.contentBlockId),
    ]
);

// ────────────────────────────────────────────────────────────────
// 审计日志（谁、何时、改哪、前后对比）
export const auditLogs = pgTable(
    "audit_logs",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        userId: uuid("user_id").references(() => users.id),
        action: varchar("action", { length: 64 }).notNull(),
        detail: jsonb("detail"),
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        index("audit_logs_user_idx").on(table.userId),
        index("audit_logs_created_idx").on(table.created_at),
    ]
);

// ────────────────────────────────────────────────────────────────
// 选词锚点素材（挂到「章节 + 句子 + 词」上；status: active | re_pending）
export const materials = pgTable(
    "materials",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        chapterId: uuid("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
        sentence: text("sentence").notNull(),
        word: varchar("word", { length: 128 }).notNull(),
        fileKey: text("file_key").notNull(),
        fileType: varchar("file_type", { length: 16 }).notNull(), // video | image
        fileName: text("file_name"),
        fileSize: integer("file_size").default(0),
        uploaderId: uuid("uploader_id").references(() => users.id),
        status: varchar("status", { length: 16 }).notNull().default("active"), // active | re_pending
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        index("materials_chapter_idx").on(table.chapterId),
        index("materials_status_idx").on(table.status),
    ]
);

// ────────────────────────────────────────────────────────────────
// 考核（三套定义）
export const exams = pgTable(
    "exams",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        code: varchar("code", { length: 32 }).notNull().unique(), // ops_assistant | product_ops | content_ops
        name: varchar("name", { length: 128 }).notNull(),
        scope: varchar("scope", { length: 64 }).notNull(),        // 如 "M1+M2"
        passScore: integer("pass_score").notNull().default(80),
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    }
);

// ────────────────────────────────────────────────────────────────
// 题目（选择 / 判断 / 实操）
export const questions = pgTable(
    "questions",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        examId: uuid("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
        qtype: varchar("qtype", { length: 16 }).notNull(),        // choice | truefalse | practical
        questionText: text("question_text").notNull(),
        options: jsonb("options"),                                // choice 选项数组
        answer: varchar("answer", { length: 255 }),               // choice: 选项下标字符串; truefalse: "true"/"false"
        sortOrder: integer("sort_order").notNull().default(0),
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        index("questions_exam_idx").on(table.examId),
    ]
);

// ────────────────────────────────────────────────────────────────
// 考核记录（员工答题判定）
export const examRecords = pgTable(
    "exam_records",
    {
        id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
        examId: uuid("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | in_progress | passed | failed | pending_practical | obj_passed
        score: integer("score"),                                  // 客观题得分
        officialPassed: boolean("official_passed").default(false),
        practicalStatus: varchar("practical_status", { length: 16 }).notNull().default("pending"), // pending | passed | failed
        answers: jsonb("answers"),
        started_at: timestamp("started_at", { withTimezone: true }),
        submitted_at: timestamp("submitted_at", { withTimezone: true }),
        created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        index("exam_records_exam_idx").on(table.examId),
        index("exam_records_user_idx").on(table.userId),
    ]
);