import { test, equal, assert, AuthError } from "@elements/app";
import { acceptInvite, findInvite } from "./services";

test("invite page", () => {
  test("a malformed token finds nothing", () => {
    equal(findInvite("not-a-token"), undefined);
  });

  test("an unknown token cannot be accepted", () => {
    let threw = false;

    try {
      acceptInvite("00000000-0000-4000-8000-000000000000", { name: "X", password: "longenough" });
    } catch (err) {
      threw = true;
      assert(err instanceof AuthError, `got ${err}`);
    }

    assert(threw);
  });
});
