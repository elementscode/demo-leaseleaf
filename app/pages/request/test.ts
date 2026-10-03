import { test, assert, sql, ForbiddenError } from "@elements/app";
import { loginAs, makeFixture } from "#app/shared/fixtures";
import route from "./index";

test("request page", () => {
  test("a neighbor cannot open another tenant's request", () => {
    let f = makeFixture();
    let id = sql<{ id: string }>(`
      insert into maintenanceRequests (unitId, tenantId, title, description)
           values (${f.otherUnitId}, ${f.otherTenantId}, 'Noise', 'Upstairs is loud at night.')
      returning id
    `).firstOrThrow().id;
    loginAs(f.tenantId);

    let threw = false;

    try {
      route({ params: { id }, query: {} } as any, {} as any);
    } catch (err) {
      threw = true;
      assert(err instanceof ForbiddenError, `got ${err}`);
    }

    assert(threw);
  });
});
