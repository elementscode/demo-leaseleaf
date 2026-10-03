import { FieldErrors, ValidationError, getAppUrl, sql, tx } from "@elements/app";
import { landlordOrThrow, isEmail, normalizeEmail } from "#app/shared/services/auth";
import { SendInviteJob } from "#app/jobs/send-invite";

export interface UnitRow {
  id: string;
  buildingId: string;
  label: string;
  bedrooms: number;
  bathrooms: number;
  leaseId: string | null;
  leaseStatus: "invited" | "active" | null;
  tenantName: string | null;
  tenantEmail: string | null;
  rentCents: number | null;
  dueDay: number | null;
  startDate: string | null;
  autopay: boolean;
  inviteId: string | null;
  openRequests: number;
  owedCents: number;
}

export interface BuildingRow {
  id: string;
  name: string;
  address: string;
  units: UnitRow[];
}

export interface BuildingForm {
  name: string;
  address: string;
}

export interface UnitForm {
  buildingId: string;
  label: string;
  bedrooms: number;
  bathrooms: number;
}

export interface InviteForm {
  unitId: string;
  name: string;
  email: string;
  rent: number;
  dueDay: number;
  startDate: string;
}

export function loadProperties(): BuildingRow[] {
  let buildings = sql<Omit<BuildingRow, "units">>(`select id, name, address from buildings order by name`).all();
  let units = sql<UnitRow>(`
    select un.id, un.buildingId, un.label, un.bedrooms, un.bathrooms::float as bathrooms,
           l.id as leaseId, l.status::text as leaseStatus,
           u.name as tenantName, u.email as tenantEmail,
           l.rentCents, l.dueDay, to_char(l.startDate, 'YYYY-MM-DD') as startDate,
           coalesce(l.autopay, false) as autopay,
           (select i.id from invites i
             where i.leaseId = l.id and i.acceptedAt is null and i.expiresAt > now()
             order by i.createdAt desc limit 1) as inviteId,
           (select count(*)::int from maintenanceRequests m
             where m.unitId = un.id and m.status <> 'done') as openRequests,
           coalesce((select sum(c.amountCents)::int from rentCharges c
                      where c.leaseId = l.id and c.status = 'open' and c.dueDate < current_date), 0) as owedCents
      from units un
      left join leases l on l.unitId = un.id and l.status <> 'ended'
      left join users u on u.id = l.tenantId
     order by un.label
  `).all();

  return buildings.map((b) => ({
    ...b,
    units: units
      .filter((u) => u.buildingId === b.id)
      .sort((a, z) => a.label.localeCompare(z.label, undefined, { numeric: true })),
  }));
}

export function inviteUrl(inviteId: string): string {
  return `${getAppUrl()}/invite/${inviteId}`;
}

/** @rpc */
export function addBuilding(form: BuildingForm): BuildingRow[] {
  landlordOrThrow();

  let errors: FieldErrors<BuildingForm> = {};

  if (!form.name.trim()) {
    errors.name = ["Name the building."];
  }

  if (!form.address.trim()) {
    errors.address = ["Add the street address."];
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  sql(`insert into buildings (name, address) values (${form.name.trim()}, ${form.address.trim()})`);

  return loadProperties();
}

/** @rpc */
export function addUnit(form: UnitForm): BuildingRow[] {
  landlordOrThrow();

  let label = form.label.trim();
  let errors: FieldErrors<UnitForm> = {};

  if (!label) {
    errors.label = ["Give the unit a number or name."];
  } else if (!sql(`select 1 from units where buildingId = ${form.buildingId} and label = ${label}`).empty()) {
    errors.label = ["That unit already exists in this building."];
  }

  if (!(form.bedrooms >= 0 && form.bedrooms <= 10)) {
    errors.bedrooms = ["0 to 10."];
  }

  if (!(form.bathrooms >= 0.5 && form.bathrooms <= 10)) {
    errors.bathrooms = ["0.5 to 10."];
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  sql(`
    insert into units (buildingId, label, bedrooms, bathrooms)
         values (${form.buildingId}, ${label}, ${Math.round(form.bedrooms)}, ${form.bathrooms})
  `);

  return loadProperties();
}

export function validateInvite(form: InviteForm): FieldErrors<InviteForm> {
  let errors: FieldErrors<InviteForm> = {};

  if (!form.name.trim()) {
    errors.name = ["Add the tenant's name."];
  }

  if (!isEmail(normalizeEmail(form.email))) {
    errors.email = ["Enter a valid email address."];
  }

  if (!(form.rent >= 1 && form.rent <= 100_000)) {
    errors.rent = ["Enter the monthly rent in dollars."];
  }

  if (!(Number.isInteger(form.dueDay) && form.dueDay >= 1 && form.dueDay <= 28)) {
    errors.dueDay = ["Pick a day from 1 to 28."];
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) {
    errors.startDate = ["Pick the lease start date."];
  }

  return errors;
}

/**
 * Creates the tenant (or reuses one who has moved out), an invited lease on the
 * unit, and an invite token, then emails the link. The lease turns active when
 * the tenant accepts.
 * @rpc
 */
export function inviteTenant(form: InviteForm): { buildings: BuildingRow[]; url: string } {
  landlordOrThrow();

  let errors = validateInvite(form);
  let email = normalizeEmail(form.email);
  let existing = sql<{ id: string; role: string; leased: boolean }>(`
    select u.id, u.role::text as role,
           exists (select 1 from leases l where l.tenantId = u.id and l.status <> 'ended') as leased
      from users u where u.email = ${email}
  `).first();

  if (existing?.role === "landlord") {
    errors.email = ["That is a landlord account."];
  } else if (existing?.leased) {
    errors.email = ["That tenant already has a lease."];
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  let occupied = !sql(`select 1 from leases where unitId = ${form.unitId} and status <> 'ended'`).empty();
  if (occupied) {
    throw new ValidationError("That unit already has a tenant.");
  }

  let inviteId = tx(() => {
    let tenantId = existing?.id ?? sql<{ id: string }>(`
      insert into users (email, name, role) values (${email}, ${form.name.trim()}, 'tenant') returning id
    `).firstOrThrow().id;

    let lease = sql<{ id: string }>(`
      insert into leases (unitId, tenantId, status, rentCents, dueDay, startDate)
           values (${form.unitId}, ${tenantId}, 'invited', ${Math.round(form.rent * 100)}, ${form.dueDay}, ${form.startDate}::date)
      returning id
    `).firstOrThrow();

    let invite = sql<{ id: string }>(`insert into invites (leaseId) values (${lease.id}) returning id`).firstOrThrow();

    new SendInviteJob({ inviteId: invite.id }).schedule();

    return invite.id;
  });

  return { buildings: loadProperties(), url: inviteUrl(inviteId) };
}

/** @rpc */
export function resendInvite(leaseId: string): { buildings: BuildingRow[]; url: string } {
  landlordOrThrow();

  let inviteId = tx(() => {
    let invite = sql<{ id: string }>(`
      insert into invites (leaseId)
      select id from leases where id = ${leaseId} and status = 'invited'
      returning id
    `).firstOrThrow("That invite was already accepted.");

    new SendInviteJob({ inviteId: invite.id }).schedule();

    return invite.id;
  });

  return { buildings: loadProperties(), url: inviteUrl(inviteId) };
}

/** @rpc */
export function cancelInvite(leaseId: string): BuildingRow[] {
  landlordOrThrow();

  sql(`delete from leases where id = ${leaseId} and status = 'invited'`);

  return loadProperties();
}
