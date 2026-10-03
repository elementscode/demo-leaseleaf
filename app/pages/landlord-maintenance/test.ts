import { test, assert, ForbiddenError } from "@elements/app";
import { loginAs, makeFixture } from "#app/shared/fixtures";
import route from "./index";

test("repair queue", () => {
  test("is for the landlord only", () => {
    let f = makeFixture();
    loginAs(f.tenantId);

    let threw = false;

    try {
      route({ params: {}, query: {} } as any, {} as any);
    } catch (err) {
      threw = true;
      assert(err instanceof ForbiddenError, `got ${err}`);
    }

    assert(threw);
  });
});
