import { AuthError, FieldErrors, ValidationError, session, sql, tx } from "@elements/app";
import { MIN_PASSWORD } from "#app/shared/services/auth";
import { ensureCharges } from "#app/shared/payments";

export interface InviteDetails {
  id: string;
  tenantName: string;
  tenantEmail: string;
  buildingName: string;
  address: string;
  unitLabel: string;
  rentCents: number;
  dueDay: number;
  startDate: string;
  landlordName: string;
  state: "open" | "expired" | "accepted";
}

export interface AcceptForm {
  name: string;
  password: string;
}

export function findInvite(token: string): InviteDetails | undefined {
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return undefined;
  }

  return sql<InviteDetails>(`
    select i.id, u.name as tenantName, u.email as tenantEmail,
           b.name as buildingName, b.address, un.label as unitLabel,
           l.rentCents, l.dueDay, to_char(l.startDate, 'YYYY-MM-DD') as startDate,
           coalesce((select name from users where role = 'landlord' order by createdAt limit 1), 'Your landlord') as landlordName,
           case when i.acceptedAt is not null or l.status <> 'invited' then 'accepted'
                when i.expiresAt < now() then 'expired'
                else 'open' end as state
      from invites i
      join leases l on l.id = i.leaseId
      join users u on u.id = l.tenantId
      join units un on un.id = l.unitId
      join buildings b on b.id = un.buildingId
     where i.id = ${token}::uuid
  `).first();
}

/**
 * Accepts an invite: the tenant picks a password, the lease turns active, the
 * first charge is created, and they are signed in.
 * @rpc
 */
export function acceptInvite(token: string, form: AcceptForm): string {
  let invite = findInvite(token);

  if (!invite || invite.state !== "open") {
    throw new AuthError("This invite link is no longer valid. Ask your landlord for a new one.");
  }

  let errors: FieldErrors<AcceptForm> = {};

  if (!form.name.trim()) {
    errors.name = ["Enter your name."];
  }

  if (form.password.length < MIN_PASSWORD) {
    errors.password = [`Use at least ${MIN_PASSWORD} characters.`];
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  let user = tx(() => {
    let lease = sql<{ id: string; tenantId: string }>(`
      update leases l set status = 'active'
        from invites i
       where i.id = ${token}::uuid and l.id = i.leaseId and l.status = 'invited'
      returning l.id, l.tenantId
    `).firstOrThrow("This invite was already used.");

    sql(`update invites set acceptedAt = now() where leaseId = ${lease.id} and acceptedAt is null`);

    let updated = sql<{ id: string; name: string }>(`
      update users
         set name = ${form.name.trim()}, passwordHash = crypt(${form.password}, genSalt('bf', 12))
       where id = ${lease.tenantId}
      returning id, name
    `).firstOrThrow();

    ensureCharges();

    return updated;
  });

  session.login({ userId: user.id, userName: user.name, role: "tenant" });

  return "/tenant";
}
