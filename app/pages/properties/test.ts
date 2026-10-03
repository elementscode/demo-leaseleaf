import { test, assert, equal, session, sql, ValidationError } from "@elements/app";
import { inviteTenant } from "./services";
import { acceptInvite, findInvite } from "#app/pages/invite/services";
import { loginAs, makeFixture } from "#app/shared/fixtures";

test("invites", () => {
  test("a landlord invites a tenant to a vacant unit and they accept", () => {
    let f = makeFixture();
    let vacant = sql<{ id: string }>(`insert into units (buildingId, label) values (${f.buildingId}, '3') returning id`).firstOrThrow().id;
    loginAs(f.landlordId);

    let result = inviteTenant({ unitId: vacant, name: "Nia New", email: "Nia@Test.Local", rent: 1450, dueDay: 3, startDate: "2020-01-01" });
    let token = result.url.split("/invite/")[1];

    equal(findInvite(token)?.state, "open");
    equal(sql(`select 1 from elements.jobs where path like '%send-invite%' and fields->>'inviteId' = ${token}`).all().length, 1);

    session.logout();

    equal(acceptInvite(token, { name: "Nia New", password: "longenough" }), "/tenant");
    equal(session.get("role"), "tenant");

    let lease = sql<{ status: string; email: string; rentCents: number }>(`
      select l.status::text as status, u.email, l.rentCents from leases l join users u on u.id = l.tenantId where l.unitId = ${vacant}
    `).firstOrThrow();
    equal(lease, { status: "active", email: "nia@test.local", rentCents: 145000 });

    equal(findInvite(token)?.state, "accepted", "the link works once");
  });

  test("an occupied unit cannot be invited to", () => {
    let f = makeFixture();
    loginAs(f.landlordId);

    let threw = false;

    try {
      inviteTenant({ unitId: f.unitId, name: "Sly", email: "sly@test.local", rent: 1000, dueDay: 1, startDate: "2020-01-01" });
    } catch (err) {
      threw = true;
      assert(err instanceof ValidationError, `got ${err}`);
    }

    assert(threw);
  });

  test("a tenant cannot send invites", () => {
    let f = makeFixture();
    loginAs(f.tenantId);

    let threw = false;

    try {
      inviteTenant({ unitId: f.unitId, name: "X", email: "x@test.local", rent: 1, dueDay: 1, startDate: "2020-01-01" });
    } catch (err) {
      threw = true;
    }

    assert(threw);
  });
});
