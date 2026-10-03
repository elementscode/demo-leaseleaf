import { Job, sql, tx } from "@elements/app";
import { ensureCharges } from "#app/shared/payments";
import { ChargeAutopayJob } from "#app/jobs/charge-autopay";
import { SendRentNoticeJob } from "#app/jobs/send-rent-notice";

export interface RentCycleJobFields {}

/**
 * The daily rent run: creates the month's charges, charges autopay cards on
 * the due date, sends a reminder three days before rent is due and a late
 * notice the day after. Each window reaches back a couple of days so a missed
 * run catches up, and the sent-at columns keep every notice to one.
 */
export class RentCycleJob extends Job<RentCycleJobFields> {
  run() {
    ensureCharges();

    let autopay = sql<{ id: string }>(`
      select c.id
        from rentCharges c
        join leases l on l.id = c.leaseId
       where c.status = 'open'
         and l.autopay and l.stripePaymentMethodId is not null
         and c.dueDate between current_date - 2 and current_date
    `).all();

    for (let charge of autopay) {
      new ChargeAutopayJob({ chargeId: charge.id }).schedule({ idempotencyKey: `autopay:${charge.id}` });
    }

    tx(() => {
      let reminders = sql<{ id: string }>(`
        update rentCharges
           set reminderSentAt = now()
         where status = 'open'
           and reminderSentAt is null
           and dueDate > current_date
           and dueDate <= current_date + 3
        returning id
      `).all();

      for (let charge of reminders) {
        new SendRentNoticeJob({ chargeId: charge.id, kind: "reminder" }).schedule();
      }

      let late = sql<{ id: string }>(`
        update rentCharges
           set lateNoticeSentAt = now()
         where status = 'open'
           and lateNoticeSentAt is null
           and dueDate < current_date
           and dueDate >= current_date - 3
        returning id
      `).all();

      for (let charge of late) {
        new SendRentNoticeJob({ chargeId: charge.id, kind: "late" }).schedule();
      }
    });
  }
}
