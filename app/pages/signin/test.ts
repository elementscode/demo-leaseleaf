import { test, assert, equal, session, AuthError } from "@elements/app";
import { signin } from "#app/shared/services/auth";
import { makeFixture } from "#app/shared/fixtures";

test("signin", () => {
  test("a landlord lands on the rent roll", () => {
    makeFixture();

    equal(signin("  OWNER@test.local ", "password1"), "/landlord");
    equal(session.get("role"), "landlord");
  });

  test("a tenant lands on their lease", () => {
    makeFixture();

    equal(signin("tess@test.local", "password1"), "/tenant");
    equal(session.get("userName"), "Tess Tenant");
  });

  test("a wrong password is refused without saying which part was wrong", () => {
    makeFixture();

    let threw = false;

    try {
      signin("tess@test.local", "nope");
    } catch (err) {
      threw = true;
      assert(err instanceof AuthError, `got ${err}`);
      equal((err as Error).message, "That email and password do not match.");
    }

    assert(threw);
    assert(!session.isLoggedIn());
  });
});
