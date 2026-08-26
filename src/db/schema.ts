import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  hue: integer("hue").notNull().default(38),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Per-user settings: CLI agent preference and per-agent model routes. */
export const userSettings = pgTable("user_settings", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
});

/** Bring-your-own-key credentials. OpenAI / Anthropic / any compatible endpoint. */
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // openai | anthropic | openrouter | custom
  label: text("label").notNull(),
  baseUrl: text("base_url"),
  model: text("model").notNull(),
  secret: text("secret").notNull(),
  authKind: text("auth_kind").notNull().default("key"), // key | oauth
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ProjectStage =
  | "intake"
  | "spec"
  | "plan"
  | "critique"
  | "awaiting_approval"
  | "build"
  | "review"
  | "ship"
  | "done";

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  spec: text("spec").notNull(),
  stage: text("stage").notNull().default("intake"),
  running: boolean("running").notNull().default(false),
  cliAgent: text("cli_agent").notNull().default("hive"),
  turnCount: integer("turn_count").notNull().default(0),
  interrupt: text("interrupt"),
  ctx: jsonb("ctx").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  author: text("author").notNull(), // 'user' | 'system' | agent id | harness id
  kind: text("kind").notNull().default("chat"), // chat | status | artifact | stage | cli
  content: text("content").notNull().default(""),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const artifacts = pgTable("artifacts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // spec | plan | arch | file | review | ship
  title: text("title").notNull(),
  path: text("path"),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull().default("nova"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  assignee: text("assignee").notNull().default("forge"),
  harness: text("harness").notNull().default("hive"),
  status: text("status").notNull().default("backlog"), // backlog | building | done
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
