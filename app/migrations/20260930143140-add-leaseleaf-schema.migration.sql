-- add leaseleaf schema

-- Auto-update updatedAt on row changes.
create or replace function touchUpdatedAt()
returns trigger
language plpgsql
as $$
begin
  new.updatedAt = now();
  return new;
end;
$$;

create type userRole as enum ('landlord', 'tenant');

create table users (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  email text not null unique,
  name text not null,
  role userRole not null default 'tenant',
  -- null until an invited tenant accepts and picks a password
  passwordHash text,
  stripeCustomerId text
);

create trigger usersTouchUpdatedAt
  before update on users
  for each row execute function touchUpdatedAt();

create table buildings (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  name text not null,
  address text not null
);

create trigger buildingsTouchUpdatedAt
  before update on buildings
  for each row execute function touchUpdatedAt();

create table units (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  buildingId uuid not null references buildings (id) on delete cascade,
  label text not null,
  bedrooms integer not null default 1,
  bathrooms numeric(3, 1) not null default 1,
  unique (buildingId, label)
);

create trigger unitsTouchUpdatedAt
  before update on units
  for each row execute function touchUpdatedAt();

create type leaseStatus as enum ('invited', 'active', 'ended');

create table leases (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  unitId uuid not null references units (id) on delete cascade,
  tenantId uuid not null references users (id) on delete cascade,
  status leaseStatus not null default 'invited',
  rentCents integer not null check (rentCents > 0),
  dueDay integer not null check (dueDay between 1 and 28),
  startDate date not null,
  autopay boolean not null default false,
  stripePaymentMethodId text,
  cardLabel text
);

-- one current lease per unit
create unique index leasesOneCurrentPerUnit on leases (unitId) where status <> 'ended';
create index leasesTenantIdIdx on leases (tenantId);

create trigger leasesTouchUpdatedAt
  before update on leases
  for each row execute function touchUpdatedAt();

create table invites (
  -- the id is the token in the emailed link, so it is random, not time ordered
  id uuid primary key default gen_random_uuid(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  leaseId uuid not null references leases (id) on delete cascade,
  expiresAt timestamptz not null default now() + interval '14 days',
  acceptedAt timestamptz
);

create trigger invitesTouchUpdatedAt
  before update on invites
  for each row execute function touchUpdatedAt();

create type chargeStatus as enum ('open', 'processing', 'paid');

create table rentCharges (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  leaseId uuid not null references leases (id) on delete cascade,
  -- YYYY-MM, a text column so a rent roll can partition a LiveTable on it
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  dueDate date not null,
  amountCents integer not null,
  status chargeStatus not null default 'open',
  paidAt timestamptz,
  method text,
  stripeSessionId text unique,
  stripePaymentIntentId text unique,
  reminderSentAt timestamptz,
  lateNoticeSentAt timestamptz,
  unique (leaseId, month)
);

create index rentChargesMonthIdx on rentCharges (month);

create trigger rentChargesTouchUpdatedAt
  before update on rentCharges
  for each row execute function touchUpdatedAt();

create type requestUrgency as enum ('low', 'normal', 'urgent');
create type requestStatus as enum ('new', 'scheduled', 'done');

create table maintenanceRequests (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  unitId uuid not null references units (id) on delete cascade,
  tenantId uuid not null references users (id) on delete cascade,
  title text not null,
  description text not null,
  urgency requestUrgency not null default 'normal',
  status requestStatus not null default 'new',
  scheduledFor date,
  completedAt timestamptz
);

create index maintenanceRequestsTenantIdIdx on maintenanceRequests (tenantId);

create trigger maintenanceRequestsTouchUpdatedAt
  before update on maintenanceRequests
  for each row execute function touchUpdatedAt();

create table maintenancePhotos (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  requestId uuid not null references maintenanceRequests (id) on delete cascade,
  name text not null,
  contentType text not null,
  data bytea not null,
  hash text generated always as (encode(sha256(data), 'hex')) stored
);

create index maintenancePhotosRequestIdIdx on maintenancePhotos (requestId);

create trigger maintenancePhotosTouchUpdatedAt
  before update on maintenancePhotos
  for each row execute function touchUpdatedAt();

create table maintenanceComments (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  requestId uuid not null references maintenanceRequests (id) on delete cascade,
  authorId uuid not null references users (id) on delete cascade,
  authorName text not null,
  authorRole userRole not null,
  body text not null
);

create index maintenanceCommentsRequestIdIdx on maintenanceComments (requestId);

create trigger maintenanceCommentsTouchUpdatedAt
  before update on maintenanceComments
  for each row execute function touchUpdatedAt();

-- One row per url the app has served from in production. The app registers
-- its own Stripe webhook endpoint the first time a tenant starts a checkout
-- and keeps the signing secret here.
create table stripeWebhooks (
  url text primary key,
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  endpointId text not null,
  secret text not null
);

create trigger stripeWebhooksTouchUpdatedAt
  before update on stripeWebhooks
  for each row execute function touchUpdatedAt();
