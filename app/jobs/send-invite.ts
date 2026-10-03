import { Job, email, getAppUrl, sql } from "@elements/app";
import { ordinal, rent } from "#app/shared/format";
import InviteEmail from "#app/emails/invite";

export interface SendInviteJobFields {
  inviteId: string;
}

interface InviteDetails {
  id: string;
  tenantName: string;
  tenantEmail: string;
  place: string;
  rentCents: number;
  dueDay: number;
  landlordName: string;
}

export class SendInviteJob extends Job<SendInviteJobFields> {
  static maxAttempts = 5;

  run() {
    let invite = sql<InviteDetails>(`
      select i.id, u.name as tenantName, u.email as tenantEmail,
             b.name || ' ' || un.label as place, l.rentCents, l.dueDay,
             coalesce((select name from users where role = 'landlord' order by createdAt limit 1), 'Your landlord') as landlordName
        from invites i
        join leases l on l.id = i.leaseId
        join users u on u.id = l.tenantId
        join units un on un.id = l.unitId
        join buildings b on b.id = un.buildingId
       where i.id = ${this.fields.inviteId} and i.acceptedAt is null
    `).first();

    if (!invite) {
      return;
    }

    email({
      to: invite.tenantEmail,
      subject: `${invite.landlordName} invited you to Leaseleaf`,
      body: new InviteEmail({
        tenantName: invite.tenantName.split(" ")[0],
        landlordName: invite.landlordName,
        place: invite.place,
        rent: rent(invite.rentCents),
        dueDay: ordinal(invite.dueDay),
        acceptUrl: `${getAppUrl()}/invite/${invite.id}`,
      }),
    });
  }
}
