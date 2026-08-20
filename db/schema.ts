import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  picture: text("picture").notNull().default(""),
  authProvider: text("auth_provider", { enum: ["google", "email", "clerk"] }).notNull().default("google"),
  clerkUserId: text("clerk_user_id"),
  passwordHash: text("password_hash"),
  emailVerifiedAt: text("email_verified_at"),
  stripeCustomerId: text("stripe_customer_id"),
  sessionVersion: integer("session_version").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  uniqueIndex("users_clerk_user_unique").on(table.clerkUserId),
]);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  plan: text("plan", { enum: ["free", "starter"] }).notNull().default("free"),
  subscriptionStatus: text("subscription_status").notNull().default("free"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  currentPeriodEnd: integer("current_period_end"),
  stripeEventCreated: integer("stripe_event_created").notNull().default(0),
  stateJson: text("state_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("workspaces_owner_unique").on(table.ownerUserId),
  index("workspaces_subscription_index").on(table.stripeSubscriptionId),
]);

export const workspaceData = sqliteTable("workspace_data", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  namespace: text("namespace").notNull(),
  itemId: text("item_id").notNull(),
  dataJson: text("data_json").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.namespace, table.itemId], name: "workspace_data_pk" }),
  index("workspace_data_workspace_namespace_index").on(table.workspaceId, table.namespace),
]);

export const emailRegistrations = sqliteTable("email_registrations", {
  email: text("email").primaryKey(),
  companyName: text("company_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastSentAt: integer("last_sent_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const rateLimits = sqliteTable("rate_limits", {
  scope: text("scope").notNull(),
  actorKey: text("actor_key").notNull(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull().default(0),
}, (table) => [
  uniqueIndex("rate_limits_window_unique").on(table.scope, table.actorKey, table.windowStart),
  index("rate_limits_window_index").on(table.windowStart),
]);

export const contactRequests = sqliteTable("contact_requests", {
  id: text("id").primaryKey(),
  companyName: text("company_name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("contact_requests_status_created_index").on(table.status, table.createdAt)]);

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  workspaceId: text("workspace_id"),
  email: text("email").notNull().default(""),
  category: text("category").notNull(),
  message: text("message").notNull(),
  pageUrl: text("page_url").notNull().default(""),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("feedback_status_created_index").on(table.status, table.createdAt),
  index("feedback_actor_index").on(table.actorId),
]);

export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  eventCreated: integer("event_created").notNull().default(0),
  status: text("status").notNull().default("processing"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  processedAt: text("processed_at"),
}, (table) => [index("stripe_events_status_index").on(table.status)]);

export const accountActions = sqliteTable("account_actions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action", { enum: ["delete_account"] }).notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("account_actions_user_action_unique").on(table.userId, table.action),
  index("account_actions_expiry_index").on(table.expiresAt),
]);

export const monitoringEvents = sqliteTable("monitoring_events", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("warning"),
  route: text("route").notNull().default(""),
  message: text("message").notNull(),
  actorHash: text("actor_hash").notNull().default(""),
  metadataJson: text("metadata_json").notNull().default("{}"),
  notifiedAt: text("notified_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("monitoring_events_category_created_index").on(table.category, table.createdAt),
  index("monitoring_events_severity_created_index").on(table.severity, table.createdAt),
]);
