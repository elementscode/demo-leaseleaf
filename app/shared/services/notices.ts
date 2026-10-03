import { sql } from "@elements/app";

export interface ChargeNotice {
  id: string;
  status: string;
  amountCents: number;
  month: string;
  dueDate: string;
  paidAt: Date | null;
  method: string | null;
  tenantName: string;
  tenantEmail: string;
  place: string;
  autopay: boolean;
  cardLabel: string | null;
  landlordName: string;
}

/** Everything an email about one charge needs, in one read. */
export function chargeNotice(chargeId: string): ChargeNotice | undefined {
  return sql<ChargeNotice>(`
    select c.id, c.status::text as status, c.amountCents, c.month,
           to_char(c.dueDate, 'YYYY-MM-DD') as dueDate, c.paidAt, c.method,
           u.name as tenantName, u.email as tenantEmail,
           b.name || ' ' || un.label as place,
           l.autopay, l.cardLabel,
           coalesce((select name from users where role = 'landlord' order by createdAt limit 1), 'Your landlord') as landlordName
      from rentCharges c
      join leases l on l.id = c.leaseId
      join users u on u.id = l.tenantId
      join units un on un.id = l.unitId
      join buildings b on b.id = un.buildingId
     where c.id = ${chargeId}
  `).first();
}
