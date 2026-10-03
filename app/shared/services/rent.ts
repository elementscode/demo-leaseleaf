import { LiveTable, ForbiddenError, sql } from "@elements/app";

export type ChargeState = "paid" | "processing" | "due" | "late";

export interface RentRow {
  id: string;
  leaseId: string;
  month: string;
  dueDate: string;
  amountCents: number;
  status: "open" | "processing" | "paid";
  state: ChargeState;
  daysLate: number;
  paidAt: Date | null;
  method: string | null;
  tenantName: string;
  tenantEmail: string;
  unitLabel: string;
  buildingName: string;
  autopay: boolean;
}

/**
 * Every rent charge with the tenant and unit it belongs to. Payments are
 * written by the Stripe return page, the webhook and the autopay job, so the
 * broadcast comes from a trigger (see the notify migration) and the channel is
 * pinned to the name it notifies. No browser writes through this table.
 */
export let rentCharges: LiveTable<RentRow> = new LiveTable<RentRow>({
  channel: (partition) => (partition ? `rentCharges:${partition}` : "rentCharges"),

  select: (p) => sql<RentRow>(`
    select c.id, c.leaseId, c.month,
           to_char(c.dueDate, 'YYYY-MM-DD') as dueDate,
           c.amountCents, c.status::text as status,
           case when c.status = 'paid' then 'paid'
                when c.status = 'processing' then 'processing'
                when c.dueDate < current_date then 'late'
                else 'due' end as state,
           greatest(current_date - c.dueDate, 0) as daysLate,
           c.paidAt, c.method,
           u.name as tenantName, u.email as tenantEmail,
           un.label as unitLabel, b.name as buildingName,
           l.autopay
      from rentCharges c
      join leases l on l.id = c.leaseId
      join users u on u.id = l.tenantId
      join units un on un.id = l.unitId
      join buildings b on b.id = un.buildingId
     where (${p.leaseId ?? null}::uuid is null or c.leaseId = ${p.leaseId ?? null}::uuid)
       and (${p.month ?? null}::text is null or c.month = ${p.month ?? null}::text)
  `),

  insert: () => {
    throw new ForbiddenError("Charges are created by the rent cycle.");
  },

  update: () => {
    throw new ForbiddenError("Payments are recorded by Stripe or the landlord.");
  },

  delete: () => {
    throw new ForbiddenError("Charges are not deleted.");
  },
});

export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}
