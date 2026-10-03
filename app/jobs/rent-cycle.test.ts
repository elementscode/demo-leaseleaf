import { test, equal, sql } from "@elements/app";
import { RentCycleJob } from "#app/jobs/rent-cycle";
import { makeCharge, makeFixture } from "#app/shared/fixtures";

function sentAt(chargeId: string) {
  return sql<{ reminder: boolean; late: boolean }>(`
    select reminderSentAt is not null as reminder, lateNoticeSentAt is not null as late
      from rentCharges where id = ${chargeId}
  `).firstOrThrow();
}

function queued(chargeId: string, kind: string): number {
  return sql<{ n: number }>(`
    select count(*)::int as n from elements.jobs
     where path like '%send-rent-notice%' and fields->>'chargeId' = ${chargeId} and fields->>'kind' = ${kind}
  `).firstOrThrow().n;
}

test("rent cycle", () => {
  test("reminds three days before rent is due, and only once", () => {
    let f = makeFixture();
    let inThree = makeCharge(f.leaseId, 3, "2020-01");
    let inFive = makeCharge(f.otherLeaseId, 5, "2020-01");

    new RentCycleJob({}).run();

    equal(sentAt(inThree).reminder, true);
    equal(sentAt(inFive).reminder, false, "five days out is too early");
    equal(queued(inThree, "reminder"), 1);

    new RentCycleJob({}).run();

    equal(queued(inThree, "reminder"), 1, "a second run sends nothing new");
  });

  test("sends a late notice the day after the due date", () => {
    let f = makeFixture();
    let yesterday = makeCharge(f.leaseId, -1, "2020-01");
    let today = makeCharge(f.otherLeaseId, 0, "2020-01");

    new RentCycleJob({}).run();

    equal(sentAt(yesterday).late, true);
    equal(sentAt(today).late, false, "due today is not late yet");
    equal(queued(yesterday, "late"), 1);
    equal(queued(today, "late"), 0);
  });

  test("never notices a paid charge", () => {
    let f = makeFixture();
    let paid = makeCharge(f.leaseId, 2, "2020-01");
    sql(`update rentCharges set status = 'paid', paidAt = now() where id = ${paid}`);

    new RentCycleJob({}).run();

    equal(sentAt(paid).reminder, false);
  });

  test("creates this month's charge for every active lease", () => {
    makeFixture();

    new RentCycleJob({}).run();

    let n = sql<{ n: number }>(`
      select count(*)::int as n from rentCharges where month = to_char(current_date, 'YYYY-MM')
    `).firstOrThrow().n;

    equal(n, 2);
  });
});
