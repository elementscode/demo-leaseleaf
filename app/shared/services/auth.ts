import { sql, session, AuthError, ForbiddenError } from "@elements/app";

export const MIN_PASSWORD = 8;

interface SigninUser {
  id: string;
  name: string;
  role: "landlord" | "tenant";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/** @rpc */
export function signin(email: string, password: string): string {
  let address = normalizeEmail(email);

  if (!address || !password) {
    throw new AuthError("Enter your email and password.");
  }

  let user = sql<SigninUser>(`
    select id, name, role from users
     where email = ${address}
       and passwordHash is not null
       and passwordHash = crypt(${password}, passwordHash)
  `).first();

  if (!user) {
    throw new AuthError("That email and password do not match.");
  }

  session.login({ userId: user.id, userName: user.name, role: user.role });

  return homeFor(user.role);
}

/** @rpc */
export function signout() {
  session.logout();
}

export function homeFor(role: "landlord" | "tenant"): string {
  return role === "landlord" ? "/landlord" : "/tenant";
}

/** Guard for landlord routes and rpc. Reads the role from the database, not the cookie. */
export function landlordOrThrow(): string {
  session.isLoggedInOrThrow();

  let userId = session.getOrThrow("userId");
  let ok = !sql(`select 1 from users where id = ${userId} and role = 'landlord'`).empty();

  if (!ok) {
    throw new ForbiddenError("Only the landlord can do that.");
  }

  return userId;
}

export function tenantOrThrow(): string {
  session.isLoggedInOrThrow();

  let userId = session.getOrThrow("userId");
  let ok = !sql(`select 1 from users where id = ${userId} and role = 'tenant'`).empty();

  if (!ok) {
    throw new ForbiddenError("This page is for tenants.");
  }

  return userId;
}
