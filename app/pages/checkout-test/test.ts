import { test, assert, equal, sql, NotFoundError } from "@elements/app";
import { loginAs, makeCharge, makeFixture } from "#app/shared/fixtures";
import { chargeAutopay } from "#app/shared/payments";
import { payRent, setupAutopay } from "#app/pages/tenant/services";
import { testCheckout } from "#app/shared/stripe";
import { loadTestCheckout, payTestCharge, saveTestCard } from "./services";

function receipts(): number {
  return sql<{ n: number }>(`select count(*)::int as n from elements.jobs where path like '%send-receipt%'`).firstOrThrow().n;
}

// Tests run against the environment's own config, so once a Stripe key is
// set (or in a production release) the test checkout is off and there is
// nothing here to drive.
test("test checkout", () => {
  if (!testCheckout()) {
    return;
  }

  test("a tenant pays rent through the test checkout", async () => {
    let f = makeFixture();
    let charge = makeCharge(f.leaseId, 2);
    loginAs(f.tenantId);

    let url = await payRent(charge);
    equal(url, `/checkout/test/rent/${charge}`, "no key, so the pay button opens the test checkout");

    let checkout = loadTestCheckout("rent", charge);
    equal(checkout.totalCents, 120000, "the amount comes from the charge");
    equal(checkout.line, "January 2020 rent · Test Terrace 1");

    equal(payTestCharge(charge), "/tenant?done=paid");

    let row = sql<{ status: string; method: string; stripeSessionId: string }>(`
      select status::text as status, method, stripeSessionId from rentCharges where id = ${charge}
    `).firstOrThrow();

    equal(row, { status: "paid", method: "card", stripeSessionId: `test_${charge}` });
    equal(receipts(), 1, "the receipt goes out, as for a Stripe payment");
  });

  test("a paid month cannot be paid again", () => {
    let f = makeFixture();
    let charge = makeCharge(f.leaseId, 2);
    loginAs(f.tenantId);
    payTestCharge(charge);

    let threw = false;

    try {
      payTestCharge(charge);
    } catch {
      threw = true;
    }

    assert(threw);
    equal(receipts(), 1);
  });

  test("a tenant cannot pay another tenant's charge", () => {
    let f = makeFixture();
    let charge = makeCharge(f.otherLeaseId, 2);
    loginAs(f.tenantId);

    let threw = false;

    try {
      payTestCharge(charge);
    } catch (err) {
      threw = true;
      assert(err instanceof NotFoundError, `got ${err}`);
    }

    assert(threw);
    equal(sql<{ status: string }>(`select status::text as status from rentCharges where id = ${charge}`).firstOrThrow().status, "open");
  });

  test("autopay set up on the test checkout pays the next charge", async () => {
    let f = makeFixture();
    loginAs(f.tenantId);

    let url = await setupAutopay();
    equal(url, `/checkout/test/autopay/${f.leaseId}`);
    equal(loadTestCheckout("autopay", f.leaseId).totalCents, 0, "saving a card charges nothing");

    saveTestCard(f.leaseId);

    let lease = sql<{ autopay: boolean; cardLabel: string }>(`select autopay, cardLabel from leases where id = ${f.leaseId}`).firstOrThrow();
    equal(lease, { autopay: true, cardLabel: "Test card ending 4242" });

    let charge = makeCharge(f.leaseId, 0);
    equal(await chargeAutopay(charge), "paid");

    let row = sql<{ status: string; method: string }>(`select status::text as status, method from rentCharges where id = ${charge}`).firstOrThrow();
    equal(row, { status: "paid", method: "autopay" });
    equal(receipts(), 1);
  });
});
