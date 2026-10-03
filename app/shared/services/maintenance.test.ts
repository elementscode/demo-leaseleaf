import { test, assert, equal, sql, ForbiddenError, ValidationError } from "@elements/app";
import { maintenanceComments, maintenanceRequests } from "#app/shared/services/maintenance";
import { loginAs, makeFixture } from "#app/shared/fixtures";

function fileRequest(unitId: string, tenantId: string): string {
  return sql<{ id: string }>(`
    insert into maintenanceRequests (unitId, tenantId, title, description, urgency)
         values (${unitId}, ${tenantId}, 'Leaky tap', 'Drips all night long.', 'normal')
    returning id
  `).firstOrThrow().id;
}

test("maintenance", () => {
  test("the landlord schedules a request and the tenant is emailed", () => {
    let f = makeFixture();
    let id = fileRequest(f.unitId, f.tenantId);
    loginAs(f.landlordId);

    let view = maintenanceRequests.view({ id });
    let row = view.get(id)!;
    view.update({ ...row, status: "scheduled", scheduledFor: "2030-05-01" });

    let saved = sql<{ status: string; scheduledFor: string }>(`
      select status::text as status, to_char(scheduledFor, 'YYYY-MM-DD') as scheduledFor from maintenanceRequests where id = ${id}
    `).firstOrThrow();
    equal(saved, { status: "scheduled", scheduledFor: "2030-05-01" });

    let emails = sql<{ n: number }>(`select count(*)::int as n from elements.jobs where path like '%maintenance-update%' and fields->>'requestId' = ${id}`).firstOrThrow().n;
    equal(emails, 1);
  });

  test("a tenant cannot change the status of their own request", () => {
    let f = makeFixture();
    let id = fileRequest(f.unitId, f.tenantId);
    loginAs(f.tenantId);

    let view = maintenanceRequests.view({ tenantId: f.tenantId });
    let threw = false;

    try {
      view.update({ ...view.get(id)!, status: "done" });
    } catch (err) {
      threw = true;
      assert(err instanceof ForbiddenError, `got ${err}`);
    }

    assert(threw);
  });

  test("a tenant cannot comment on a neighbor's request", () => {
    let f = makeFixture();
    let id = fileRequest(f.otherUnitId, f.otherTenantId);
    loginAs(f.tenantId);

    let threw = false;

    try {
      maintenanceComments.view({ requestId: id }).insert({ body: "hello" });
    } catch (err) {
      threw = true;
      assert(err instanceof ForbiddenError, `got ${err}`);
    }

    assert(threw);
  });

  test("comments take the author from the session, not the payload", () => {
    let f = makeFixture();
    let id = fileRequest(f.unitId, f.tenantId);
    loginAs(f.tenantId);

    maintenanceComments.view({ requestId: id }).insert({ body: "Still dripping", authorName: "Olive Owner", authorRole: "landlord" });

    let c = sql<{ authorName: string; authorRole: string }>(`
      select authorName, authorRole::text as authorRole from maintenanceComments where requestId = ${id}
    `).firstOrThrow();
    equal(c, { authorName: "Tess Tenant", authorRole: "tenant" });
  });

  test("an empty comment is refused", () => {
    let f = makeFixture();
    let id = fileRequest(f.unitId, f.tenantId);
    loginAs(f.tenantId);

    let threw = false;

    try {
      maintenanceComments.view({ requestId: id }).insert({ body: "   " });
    } catch (err) {
      threw = true;
      assert(err instanceof ValidationError, `got ${err}`);
    }

    assert(threw);
  });
});
