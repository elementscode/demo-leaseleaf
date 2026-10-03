import { test, assert, equal, sql } from "@elements/app";
import { ensureCharges, markPaid } from "#app/shared/payments";
import { lockRentCharges, makeCharge, makeFixture } from "#app/shared/fixtures";

test("payments", () => {
  test("ensureCharges is safe to run twice", () => {
    lockRentCharges();
    let f = makeFixture();

    let first = ensureCharges();
    let second = ensureCharges();

    assert(first >= 2, `created ${first}`);
    equal(second, 0);

    let row = sql<{ amountCents: number }>(`
      select amountCents from rentCharges where leaseId = ${f.leaseId} and month = to_char(current_date, 'YYYY-MM')
    `).firstOrThrow();

    equal(row.amountCents, 120000);
  });

  test("ensureCharges skips invited leases", () => {
    lockRentCharges();
    let f = makeFixture();
    sql(`update leases set status = 'invited' where id = ${f.otherLeaseId}`);

    ensureCharges();

    equal(sql(`select 1 from rentCharges where leaseId = ${f.otherLeaseId}`).all().length, 0);
  });

  test("markPaid records a payment once and sends one receipt", () => {
    let f = makeFixture();
    let charge = makeCharge(f.leaseId, 0);

    equal(markPaid(charge, "card", { sessionId: "cs_test_1" }), true);
    equal(markPaid(charge, "card", { sessionId: "cs_test_1" }), false, "the webhook arriving second changes nothing");

    let row = sql<{ status: string; method: string }>(`select status::text as status, method from rentCharges where id = ${charge}`).firstOrThrow();
    equal(row.status, "paid");
    equal(row.method, "card");

    let receipts = sql<{ n: number }>(`select count(*)::int as n from elements.jobs where path like '%send-receipt%' and fields->>'chargeId' = ${charge}`).firstOrThrow().n;
    equal(receipts, 1);
  });
});
