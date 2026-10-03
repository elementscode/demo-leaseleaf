import { test, assert, equal, session, AuthError } from "@elements/app";
import { signin } from "#app/shared/services/auth";
import { makeFixture } from "#app/shared/fixtures";

test("signin", () => {
  test("a landlord lands on the rent roll", () => {
    let f = makeFixture();

    equal(signin(`  ${f.landlordEmail.toUpperCase()} `, "password1"), "/landlord");
    equal(session.get("role"), "landlord");
  });

  test("a tenant lands on their lease", () => {
    let f = makeFixture();

    equal(signin(f.tenantEmail, "password1"), "/tenant");
    equal(session.get("userName"), "Tess Tenant");
  });

  test("a wrong password is refused without saying which part was wrong", () => {
    let f = makeFixture();

    let threw = false;

    try {
      signin(f.tenantEmail, "nope");
    } catch (err) {
      threw = true;
      assert(err instanceof AuthError, `got ${err}`);
      equal((err as Error).message, "That email and password do not match.");
    }

    assert(threw);
    assert(!session.isLoggedIn());
  });
});
