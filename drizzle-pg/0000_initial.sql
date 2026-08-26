create table users (
  id text primary key,
  email text not null,
  name text not null,
  picture text not null default '',
  auth_provider text not null default 'google' check (auth_provider in ('google', 'email', 'clerk')),
  clerk_user_id text,
  password_hash text,
  email_verified_at text,
  stripe_customer_id text,
  session_version integer not null default 0,
  created_at text not null,
  updated_at text not null
);
create unique index users_email_unique on users (email);
create unique index users_clerk_user_unique on users (clerk_user_id) where clerk_user_id is not null;

create table workspaces (
  id text primary key,
  owner_user_id text not null references users(id) on delete cascade,
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'starter')),
  subscription_status text not null default 'free',
  stripe_subscription_id text,
  stripe_price_id text,
  current_period_end integer,
  stripe_event_created integer not null default 0,
  state_json text not null default '{}',
  created_at text not null,
  updated_at text not null
);
create unique index workspaces_owner_unique on workspaces (owner_user_id);
create index workspaces_subscription_index on workspaces (stripe_subscription_id) where stripe_subscription_id is not null;

create table workspace_data (
  workspace_id text not null references workspaces(id) on delete cascade,
  namespace text not null,
  item_id text not null,
  data_json text not null,
  updated_at text not null,
  primary key (workspace_id, namespace, item_id)
);
create index workspace_data_workspace_namespace_index on workspace_data (workspace_id, namespace);

create table email_registrations (
  email text primary key,
  company_name text not null,
  password_hash text not null,
  code_hash text not null,
  expires_at integer not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_sent_at integer not null,
  created_at text not null
);

create table rate_limits (
  scope text not null,
  actor_key text not null,
  window_start integer not null,
  count integer not null default 0 check (count >= 0),
  primary key (scope, actor_key, window_start)
);
create index rate_limits_window_index on rate_limits (window_start);

create table contact_requests (
  id text primary key,
  company_name text not null,
  email text not null,
  message text not null default '',
  status text not null default 'new',
  created_at text not null
);
create index contact_requests_status_created_index on contact_requests (status, created_at);

create table feedback (
  id text primary key,
  actor_id text not null,
  workspace_id text,
  email text not null default '',
  category text not null,
  message text not null,
  page_url text not null default '',
  status text not null default 'new',
  created_at text not null
);
create index feedback_status_created_index on feedback (status, created_at);
create index feedback_actor_index on feedback (actor_id);

create table stripe_events (
  id text primary key,
  event_type text not null,
  event_created integer not null default 0,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  error text,
  created_at text not null,
  processed_at text
);
create index stripe_events_status_index on stripe_events (status);

create table account_actions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  action text not null check (action in ('delete_account')),
  code_hash text not null,
  expires_at integer not null,
  attempts integer not null default 0 check (attempts >= 0),
  created_at text not null
);
create unique index account_actions_user_action_unique on account_actions (user_id, action);
create index account_actions_expiry_index on account_actions (expires_at);

create table monitoring_events (
  id text primary key,
  category text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  route text not null default '',
  message text not null,
  actor_hash text not null default '',
  metadata_json text not null default '{}',
  notified_at text,
  created_at text not null
);
create index monitoring_events_category_created_index on monitoring_events (category, created_at);
create index monitoring_events_severity_created_index on monitoring_events (severity, created_at);
