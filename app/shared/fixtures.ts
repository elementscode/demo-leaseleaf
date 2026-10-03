import { session, sql } from "@elements/app";

export interface Fixture {
  landlordId: string;
  tenantId: string;
  otherTenantId: string;
  buildingId: string;
  unitId: string;
  otherUnitId: string;
  leaseId: string;
  otherLeaseId: string;
  landlordEmail: string;
  tenantEmail: string;
}

/** A landlord, one building with two leased units, and their tenants. For tests. */
export function makeFixture(dueDay = 1): Fixture {
  // users.email is unique and test files run in parallel, so each fixture gets its own addresses
  let tag = crypto.randomUUID().slice(0, 8);
  let landlordEmail = `owner-${tag}@test.local`;
  let tenantEmail = `tess-${tag}@test.local`;
  let otherTenantEmail = `ned-${tag}@test.local`;

  let landlordId = sql<{ id: string }>(`
    insert into users (email, name, role, passwordHash)
         values (${landlordEmail}, 'Olive Owner', 'landlord', crypt('password1', genSalt('bf', 4)))
    returning id
  `).firstOrThrow().id;

  let tenantId = sql<{ id: string }>(`
    insert into users (email, name, role, passwordHash)
         values (${tenantEmail}, 'Tess Tenant', 'tenant', crypt('password1', genSalt('bf', 4)))
    returning id
  `).firstOrThrow().id;

  let otherTenantId = sql<{ id: string }>(`
    insert into users (email, name, role, passwordHash)
         values (${otherTenantEmail}, 'Ned Neighbor', 'tenant', crypt('password1', genSalt('bf', 4)))
    returning id
  `).firstOrThrow().id;

  let buildingId = sql<{ id: string }>(`
    insert into buildings (name, address) values ('Test Terrace', '1 Test Way') returning id
  `).firstOrThrow().id;

  let unitId = sql<{ id: string }>(`insert into units (buildingId, label) values (${buildingId}, '1') returning id`).firstOrThrow().id;
  let otherUnitId = sql<{ id: string }>(`insert into units (buildingId, label) values (${buildingId}, '2') returning id`).firstOrThrow().id;

  let leaseId = sql<{ id: string }>(`
    insert into leases (unitId, tenantId, status, rentCents, dueDay, startDate)
         values (${unitId}, ${tenantId}, 'active', 120000, ${dueDay}, current_date - interval '1 year')
    returning id
  `).firstOrThrow().id;

  let otherLeaseId = sql<{ id: string }>(`
    insert into leases (unitId, tenantId, status, rentCents, dueDay, startDate)
         values (${otherUnitId}, ${otherTenantId}, 'active', 99000, ${dueDay}, current_date - interval '1 year')
    returning id
  `).firstOrThrow().id;

  return { landlordId, tenantId, otherTenantId, buildingId, unitId, otherUnitId, leaseId, otherLeaseId, landlordEmail, tenantEmail };
}

export function loginAs(userId: string) {
  let user = sql<{ name: string; role: "landlord" | "tenant" }>(`select name, role from users where id = ${userId}`).firstOrThrow();

  session.login({ userId, userName: user.name, role: user.role });
}

/** A charge on a lease due `dueInDays` from today. */
export function makeCharge(leaseId: string, dueInDays: number, month = "2020-01"): string {
  return sql<{ id: string }>(`
    insert into rentCharges (leaseId, month, dueDate, amountCents)
    select id, ${month}, current_date + ${dueInDays}::int, rentCents from leases where id = ${leaseId}
    returning id
  `).firstOrThrow().id;
}

/**
 * ensureCharges inserts this month's charge for every active lease, seed
 * leases included, so two test files running it at once insert the same
 * (leaseId, month) keys and wait on, or deadlock with, each other. Taking
 * this lock first runs those tests one at a time; it is released when the
 * test's transaction rolls back.
 */
export function lockRentCharges() {
  sql(`select pg_advisory_xact_lock(hashtext('leaseleaf:ensureCharges'))`);
}
