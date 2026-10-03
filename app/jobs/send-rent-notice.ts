import { Job, email } from "@elements/app";
import { chargeNotice } from "#app/shared/services/notices";
import { day, rent } from "#app/shared/format";
import RentReminderEmail from "#app/emails/rent-reminder";
import LateNoticeEmail from "#app/emails/late-notice";

export interface SendRentNoticeJobFields {
  chargeId: string;
  kind: string;
}

export class SendRentNoticeJob extends Job<SendRentNoticeJobFields> {
  static maxAttempts = 5;

  run() {
    let n = chargeNotice(this.fields.chargeId);

    // paid between the cycle run and this send: nothing to remind about
    if (!n || n.status === "paid") {
      return;
    }

    let firstName = n.tenantName.split(" ")[0];

    if (this.fields.kind === "late") {
      email({
        to: n.tenantEmail,
        subject: `Rent for ${n.place} is past due`,
        body: new LateNoticeEmail({
          tenantName: firstName,
          amount: rent(n.amountCents),
          dueDate: day(n.dueDate),
          place: n.place,
          landlordName: n.landlordName,
        }),
      });

      return;
    }

    email({
      to: n.tenantEmail,
      subject: `Rent of ${rent(n.amountCents)} is due ${day(n.dueDate)}`,
      body: new RentReminderEmail({
        tenantName: firstName,
        amount: rent(n.amountCents),
        dueDate: day(n.dueDate),
        place: n.place,
        autopay: n.autopay,
        cardLabel: n.cardLabel ?? "your saved card",
      }),
    });
  }
}
