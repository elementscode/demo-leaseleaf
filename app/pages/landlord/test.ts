import { test, assert, equal, sql, ForbiddenError, ValidationError } from "@elements/app";
import { loginAs, makeCharge, makeFixture } from "#app/shared/fixtures";
import { recordPayment } from "./services";

test("rent roll", () => {
  test("the landlord records a check", () => {
    let f = makeFixture();
    let charge = makeCharge(f.leaseId, -3);
    loginAs(f.landlordId);

    recordPayment(charge, "check");

    let row = sql<{ status: string; method: string }>(`select status::text as status, method from rentCharges where id = ${charge}`).firstOrThrow();
    equal(row, { status: "paid", method: "check" });
  });

  test("recording the same payment twice is refused", () => {
    let f = makeFixture();
    let charge = makeCharge(f.leaseId, -3);
    loginAs(f.landlordId);
    recordPayment(charge, "cash");

    let threw = false;

    try {
      recordPayment(charge, "cash");
    } catch (err) {
      threw = true;
      assert(err instanceof ValidationError, `got ${err}`);
    }

    assert(threw);
  });

  test("a tenant cannot mark their own rent paid", () => {
    let f = makeFixture();
    let charge = makeCharge(f.leaseId, -3);
    loginAs(f.tenantId);

    let threw = false;

    try {
      recordPayment(charge, "cash");
    } catch (err) {
      threw = true;
      assert(err instanceof ForbiddenError, `got ${err}`);
    }

    assert(threw);
    equal(sql<{ status: string }>(`select status::text as status from rentCharges where id = ${charge}`).firstOrThrow().status, "open");
  });
});
