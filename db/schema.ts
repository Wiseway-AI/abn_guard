import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  picture: text("picture").notNull().default(""),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  plan: text("plan", { enum: ["free", "starter"] }).notNull().default("free"),
  subscriptionStatus: text("subscription_status").notNull().default("free"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  currentPeriodEnd: integer("current_period_end"),
  stateJson: text("state_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("workspaces_owner_unique").on(table.ownerUserId),
  index("workspaces_subscription_index").on(table.stripeSubscriptionId),
]);
