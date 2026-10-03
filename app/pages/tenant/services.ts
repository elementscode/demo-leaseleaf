import { ValidationError, sql } from "@elements/app";
import { tenantOrThrow } from "#app/shared/services/auth";
import { startAutopaySetup, startRentCheckout } from "#app/shared/payments";

export interface Lease {
  id: string;
  unitLabel: string;
  bedrooms: number;
  bathrooms: number;
  buildingName: string;
  address: string;
  rentCents: number;
  dueDay: number;
  startDate: string;
  autopay: boolean;
  cardLabel: string | null;
}

export function currentLease(tenantId: string): Lease | undefined {
  return sql<Lease>(`
    select l.id, un.label as unitLabel, un.bedrooms, un.bathrooms::float as bathrooms,
           b.name as buildingName, b.address,
           l.rentCents, l.dueDay, to_char(l.startDate, 'YYYY-MM-DD') as startDate,
           l.autopay, l.cardLabel
      from leases l
      join units un on un.id = l.unitId
      join buildings b on b.id = un.buildingId
     where l.tenantId = ${tenantId} and l.status = 'active'
     order by l.startDate desc
     limit 1
  `).first();
}

function leaseOrThrow(tenantId: string): Lease {
  let lease = currentLease(tenantId);

  if (!lease) {
    throw new ValidationError("You do not have an active lease.");
  }

  return lease;
}

/** @rpc */
export async function payRent(chargeId: string): Promise<string> {
  let tenantId = tenantOrThrow();

  return await startRentCheckout(chargeId, tenantId);
}

/** @rpc */
export async function setupAutopay(): Promise<string> {
  let tenantId = tenantOrThrow();

  let lease = leaseOrThrow(tenantId);

  return await startAutopaySetup(lease.id, tenantId);
}

/** @rpc */
export function turnOffAutopay(): Lease {
  let tenantId = tenantOrThrow();
  let lease = leaseOrThrow(tenantId);

  sql(`update leases set autopay = false where id = ${lease.id}`);

  return leaseOrThrow(tenantId);
}

/** @rpc */
export function turnOnAutopay(): Lease {
  let tenantId = tenantOrThrow();
  let lease = leaseOrThrow(tenantId);

  if (!lease.cardLabel) {
    throw new ValidationError("Add a card first.");
  }

  sql(`update leases set autopay = true where id = ${lease.id} and stripePaymentMethodId is not null`);

  return leaseOrThrow(tenantId);
}
