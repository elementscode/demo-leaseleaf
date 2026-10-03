import Stripe from "stripe";
import { NotFoundError, ValidationError, getAppUrl, sql, tx } from "@elements/app";
import { stripe, testCheckout } from "#app/shared/stripe";
import { ensureWebhook } from "#app/shared/stripe-webhook";
import { monthName } from "#app/shared/format";
import { SendReceiptJob } from "#app/jobs/send-receipt";

export interface PayableCharge {
  id: string;
  amountCents: number;
  month: string;
  unitLabel: string;
  buildingName: string;
  tenantId: string;
}

interface Customer {
  id: string;
  email: string;
  name: string;
  stripeCustomerId: string | null;
}

/** One Stripe customer per tenant, created the first time they pay. */
export async function customerFor(userId: string): Promise<string> {
  let user = sql<Customer>(`select id, email, name, stripeCustomerId from users where id = ${userId}`).firstOrThrow();

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  let customer = await stripe().customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: user.id },
  });

  sql(`update users set stripeCustomerId = ${customer.id} where id = ${user.id} and stripeCustomerId is null`);

  return sql<{ stripeCustomerId: string }>(`select stripeCustomerId from users where id = ${user.id}`).firstOrThrow().stripeCustomerId;
}

/**
 * One open rent charge on the tenant's own lease, or an error. The amount
 * always comes from this row, never from the browser.
 */
export function payableCharge(chargeId: string, tenantId: string): PayableCharge {
  let charge = sql<PayableCharge>(`
    select c.id, c.amountCents, c.month, un.label as unitLabel, b.name as buildingName, l.tenantId
      from rentCharges c
      join leases l on l.id = c.leaseId
      join units un on un.id = l.unitId
      join buildings b on b.id = un.buildingId
     where c.id = ${chargeId} and l.tenantId = ${tenantId}
  `).first();

  if (!charge) {
    throw new NotFoundError("That charge is not on your lease.");
  }

  let open = !sql(`select 1 from rentCharges where id = ${chargeId} and status = 'open'`).empty();
  if (!open) {
    throw new ValidationError("That month is already paid.");
  }

  return charge;
}

/** The line a tenant sees on Checkout and on the test checkout. */
export function chargeLine(charge: PayableCharge): string {
  return `${monthName(charge.month)} rent · ${charge.buildingName} ${charge.unitLabel}`;
}

/**
 * Returns the url to send the tenant to for one rent charge: Stripe
 * Checkout, or the in-app test checkout when there is no key.
 */
export async function startRentCheckout(chargeId: string, tenantId: string): Promise<string> {
  let charge = payableCharge(chargeId, tenantId);

  if (testCheckout()) {
    return `/checkout/test/rent/${charge.id}`;
  }

  await ensureWebhook();

  let customer = await customerFor(tenantId);
  let checkout = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    payment_method_types: ["card"],
    client_reference_id: charge.id,
    metadata: { chargeId: charge.id },
    payment_intent_data: { metadata: { chargeId: charge.id } },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: charge.amountCents,
        product_data: { name: chargeLine(charge) },
      },
    }],
    success_url: `${getAppUrl()}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getAppUrl()}/tenant`,
  });

  return checkout.url!;
}

/** Starts a Checkout in setup mode, which saves a card for autopay without charging it. */
export async function startAutopaySetup(leaseId: string, tenantId: string): Promise<string> {
  if (testCheckout()) {
    return `/checkout/test/autopay/${leaseId}`;
  }

  await ensureWebhook();

  let customer = await customerFor(tenantId);
  let checkout = await stripe().checkout.sessions.create({
    mode: "setup",
    customer,
    currency: "usd",
    payment_method_types: ["card"],
    client_reference_id: leaseId,
    metadata: { leaseId },
    success_url: `${getAppUrl()}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getAppUrl()}/tenant`,
  });

  return checkout.url!;
}

function cardLabel(pm: Stripe.PaymentMethod): string {
  if (!pm.card) {
    return "your saved card";
  }

  let brand = pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1);

  return `${brand} ending ${pm.card.last4}`;
}

/**
 * Records what a finished Checkout Session did. Idempotent: the return page
 * and the webhook both call it, in either order, any number of times. It
 * trusts only what it reads back from Stripe.
 */
export async function fulfillCheckout(sessionId: string): Promise<"paid" | "autopay" | "pending"> {
  let checkout = await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ["setup_intent.payment_method"],
  });

  if (checkout.mode === "setup") {
    let intent = checkout.setup_intent as Stripe.SetupIntent | null;
    let pm = intent?.payment_method as Stripe.PaymentMethod | null;

    if (!intent || intent.status !== "succeeded" || !pm || !checkout.client_reference_id) {
      return "pending";
    }

    saveCard(checkout.client_reference_id, pm.id, cardLabel(pm));

    return "autopay";
  }

  if (checkout.payment_status !== "paid" || !checkout.client_reference_id) {
    return "pending";
  }

  markPaid(checkout.client_reference_id, "card", {
    sessionId: checkout.id,
    paymentIntentId: typeof checkout.payment_intent === "string" ? checkout.payment_intent : checkout.payment_intent?.id ?? null,
  });

  return "paid";
}

/** Saves a card on a lease and turns autopay on. Stripe and the test checkout both land here. */
export function saveCard(leaseId: string, paymentMethodId: string, label: string) {
  sql(`
    update leases
       set autopay = true, stripePaymentMethodId = ${paymentMethodId}, cardLabel = ${label}
     where id = ${leaseId}
  `);
}

/**
 * Marks a charge paid once: the one place a rent payment is recorded, from
 * Stripe Checkout, the webhook, autopay, the test checkout or the landlord.
 * The `status <> 'paid'` guard keeps the receipt to the first caller when the
 * return page and the webhook race.
 */
export function markPaid(chargeId: string, method: string, ids: { sessionId?: string | null; paymentIntentId?: string | null } = {}): boolean {
  return tx(() => {
    let updated = sql<{ id: string }>(`
      update rentCharges
         set status = 'paid',
             paidAt = now(),
             method = ${method},
             stripeSessionId = coalesce(${ids.sessionId ?? null}, stripeSessionId),
             stripePaymentIntentId = coalesce(${ids.paymentIntentId ?? null}, stripePaymentIntentId)
       where id = ${chargeId} and status <> 'paid'
      returning id
    `).first();

    if (updated) {
      new SendReceiptJob({ chargeId }).schedule();
    }

    return !!updated;
  });
}

interface AutopayCharge {
  id: string;
  amountCents: number;
  month: string;
  stripePaymentMethodId: string;
  stripeCustomerId: string | null;
  place: string;
}

/**
 * Charges the saved card for one charge, off session. The charge is claimed
 * first (open to processing) so two runs cannot both charge it, and Stripe's
 * idempotency key covers a retry of the same call. A card saved on the test
 * checkout (`test_` id) pays without Stripe while there is no key.
 */
export async function chargeAutopay(chargeId: string): Promise<"paid" | "skipped" | "failed"> {
  let charge = sql<AutopayCharge>(`
    update rentCharges c
       set status = 'processing'
      from leases l, users u, units un, buildings b
     where c.id = ${chargeId}
       and c.status = 'open'
       and l.id = c.leaseId and l.autopay and l.stripePaymentMethodId is not null
       and u.id = l.tenantId
       and (u.stripeCustomerId is not null or l.stripePaymentMethodId like 'test\_%')
       and un.id = l.unitId and b.id = un.buildingId
    returning c.id, c.amountCents, c.month, l.stripePaymentMethodId, u.stripeCustomerId,
              b.name || ' ' || un.label as place
  `).first();

  if (!charge) {
    return "skipped";
  }

  if (charge.stripePaymentMethodId.startsWith("test_")) {
    if (testCheckout()) {
      markPaid(charge.id, "autopay", { paymentIntentId: `test_${charge.id}` });
      return "paid";
    }

    sql(`update rentCharges set status = 'open' where id = ${charge.id} and status = 'processing'`);

    return "failed";
  }

  try {
    let intent = await stripe().paymentIntents.create({
      amount: charge.amountCents,
      currency: "usd",
      customer: charge.stripeCustomerId!,
      payment_method: charge.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      description: `${monthName(charge.month)} rent · ${charge.place} (autopay)`,
      metadata: { chargeId: charge.id },
    }, { idempotencyKey: `autopay-${charge.id}` });

    if (intent.status === "succeeded") {
      markPaid(charge.id, "autopay", { paymentIntentId: intent.id });
      return "paid";
    }
  } catch (err) {
    console.error(`autopay failed for charge ${charge.id}: ${(err as Error).message}`);
  }

  sql(`update rentCharges set status = 'open' where id = ${charge.id} and status = 'processing'`);

  return "failed";
}

/**
 * Creates this month's charge for every active lease, and next month's once
 * it is within five days of being due. Safe to run any number of times.
 */
export function ensureCharges(): number {
  let created = sql<{ id: string }>(`
    insert into rentCharges (leaseId, month, dueDate, amountCents)
    select l.id, to_char(m.start, 'YYYY-MM'), due.d, l.rentCents
      from leases l
     cross join lateral (
       select (date_trunc('month', current_date) + make_interval(months => n))::date as start
         from generate_series(0, 1) as n
     ) m
     cross join lateral (select (m.start + make_interval(days => l.dueDay - 1))::date as d) due
     where l.status = 'active'
       and due.d >= date_trunc('month', l.startDate)
       and due.d - 5 <= current_date
    on conflict (leaseId, month) do nothing
    returning id
  `).all();

  return created.length;
}
