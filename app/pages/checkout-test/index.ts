import { NotFoundError, Request, Response, redirect, sql } from "@elements/app";
import { tenantOrThrow } from "#app/shared/services/auth";
import { testCheckout } from "#app/shared/stripe";
import { loadTestCheckout } from "./services";
import html from "./template";

/** The in-app stand-in for Stripe Checkout. Development only, and only without a key. */
export default function route(req: Request, res: Response) {
  if (!testCheckout()) {
    throw new NotFoundError();
  }

  let tenantId = tenantOrThrow();
  let { kind, id } = req.params;

  if (kind === "rent") {
    let paid = !sql(`
      select 1
        from rentCharges c
        join leases l on l.id = c.leaseId
       where c.id = ${id} and l.tenantId = ${tenantId} and c.status <> 'open'
    `).empty();

    if (paid) {
      redirect("/tenant");
      return;
    }
  }

  return new html({ checkout: loadTestCheckout(kind, id) });
}
