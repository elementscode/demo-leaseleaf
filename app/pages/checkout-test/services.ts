import { ForbiddenError, NotFoundError, sql } from "@elements/app";
import { tenantOrThrow } from "#app/shared/services/auth";
import { chargeLine, markPaid, payableCharge, saveCard } from "#app/shared/payments";
import { testCheckout } from "#app/shared/stripe";
import { monthName, ordinal, rent } from "#app/shared/format";

export type TestCheckoutKind = "rent" | "autopay";

/** What the test checkout page shows: the one line, and what is due today. */
export interface TestCheckout {
  kind: TestCheckoutKind;
  id: string;
  email: string;
  heading: string;
  line: string;
  detail: string;
  totalCents: number;
}

function testCheckoutOrThrow() {
  if (!testCheckout()) {
    throw new ForbiddenError("The test checkout is off.");
  }
}

function tenantEmail(tenantId: string): string {
  return sql<{ email: string }>(`select email from users where id = ${tenantId}`).firstOrThrow().email;
}

interface AutopayLease {
  id: string;
  rentCents: number;
  dueDay: number;
  place: string;
}

function activeLease(leaseId: string, tenantId: string): AutopayLease {
  let lease = sql<AutopayLease>(`
    select l.id, l.rentCents, l.dueDay, b.name || ' ' || un.label as place
      from leases l
      join units un on un.id = l.unitId
      join buildings b on b.id = un.buildingId
     where l.id = ${leaseId} and l.tenantId = ${tenantId} and l.status = 'active'
  `).first();

  if (!lease) {
    throw new NotFoundError("That lease is not yours.");
  }

  return lease;
}

/** Loads the test checkout for the signed-in tenant. Same ownership checks as Stripe Checkout. */
export function loadTestCheckout(kind: string, id: string): TestCheckout {
  testCheckoutOrThrow();

  let tenantId = tenantOrThrow();

  if (kind === "rent") {
    let charge = payableCharge(id, tenantId);

    return {
      kind,
      id,
      email: tenantEmail(tenantId),
      heading: `Pay ${monthName(charge.month)} rent`,
      line: chargeLine(charge),
      detail: "One payment",
      totalCents: charge.amountCents,
    };
  }

  if (kind === "autopay") {
    let lease = activeLease(id, tenantId);

    return {
      kind,
      id,
      email: tenantEmail(tenantId),
      heading: "Save a card for autopay",
      line: `Autopay · ${lease.place}`,
      detail: `${rent(lease.rentCents)} on the ${ordinal(lease.dueDay)} of each month`,
      totalCents: 0,
    };
  }

  throw new NotFoundError();
}

/**
 * The test checkout's Pay button. Reads the amount from the charge, never the
 * browser, and records it through markPaid, the same as a Stripe payment.
 * @rpc
 */
export function payTestCharge(chargeId: string): string {
  testCheckoutOrThrow();

  let charge = payableCharge(chargeId, tenantOrThrow());
  markPaid(charge.id, "card", { sessionId: `test_${charge.id}` });

  return "/tenant?done=paid";
}

/**
 * The test checkout's Save button for autopay. Saves a stand-in card, which the
 * autopay job charges without Stripe while there is no key.
 * @rpc
 */
export function saveTestCard(leaseId: string): string {
  testCheckoutOrThrow();

  let lease = activeLease(leaseId, tenantOrThrow());
  saveCard(lease.id, `test_${lease.id}`, "Test card ending 4242");

  return "/tenant?done=autopay";
}
