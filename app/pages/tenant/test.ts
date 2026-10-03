import { test, assert, equal, sql, ForbiddenError } from "@elements/app";
import { rentCharges } from "#app/shared/services/rent";
import { loginAs, makeCharge, makeFixture } from "#app/shared/fixtures";
import { turnOffAutopay } from "./services";
import route from "./index";

test("tenant", () => {
  test("a tenant's charges show late once the due date passes", () => {
    let f = makeFixture();
    makeCharge(f.leaseId, -2, "2020-01");
    makeCharge(f.leaseId, 4, "2020-02");
    makeCharge(f.otherLeaseId, -2, "2020-01");

    let view = rentCharges.view({ leaseId: f.leaseId });
    let states = view.map((c) => `${c.month}:${c.state}`).sort();

    equal(states, ["2020-01:late", "2020-02:due"], "only this lease's charges");
  });

  test("the landlord cannot open the tenant page", () => {
    let f = makeFixture();
    loginAs(f.landlordId);

    let threw = false;

    try {
      route({ query: {}, params: {} } as any, {} as any);
    } catch (err) {
      threw = true;
      assert(err instanceof ForbiddenError, `got ${err}`);
    }

    assert(threw);
  });

  test("a tenant can pause autopay", () => {
    let f = makeFixture();
    sql(`update leases set autopay = true, stripePaymentMethodId = 'pm_test', cardLabel = 'Visa ending 4242' where id = ${f.leaseId}`);
    loginAs(f.tenantId);

    let lease = turnOffAutopay();

    equal(lease.autopay, false);
    equal(lease.cardLabel, "Visa ending 4242", "the card stays saved");
  });
});
