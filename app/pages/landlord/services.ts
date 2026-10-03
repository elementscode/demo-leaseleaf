import { ValidationError, sql } from "@elements/app";
import { landlordOrThrow } from "#app/shared/services/auth";
import { markPaid } from "#app/shared/payments";
import { RentCycleJob } from "#app/jobs/rent-cycle";

export const OFFLINE_METHODS = ["check", "cash", "transfer"] as const;

export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

/** @rpc */
export function recordPayment(chargeId: string, method: OfflineMethod) {
  landlordOrThrow();

  if (!OFFLINE_METHODS.includes(method)) {
    throw new ValidationError("Pick check, cash or bank transfer.");
  }

  if (!markPaid(chargeId, method)) {
    throw new ValidationError("That charge is already paid.");
  }
}

/** Runs today's rent cycle now instead of waiting for the 9am cron. @rpc */
export function runRentCycle() {
  landlordOrThrow();

  new RentCycleJob({}).schedule();
}

/**
 * The month a landlord most likely wants: the next one with rent coming due
 * within a week, otherwise the current month.
 */
export function defaultMonth(): string {
  return sql<{ month: string }>(`
    select coalesce(
      (select month from rentCharges
        where status = 'open' and dueDate >= current_date and dueDate <= current_date + 7
        order by dueDate limit 1),
      to_char(current_date, 'YYYY-MM')
    ) as month
  `).firstOrThrow().month;
}
