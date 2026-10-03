import { Request, Response, redirect, session } from "@elements/app";
import { fulfillCheckout } from "#app/shared/payments";

/**
 * Stripe sends the tenant back here. Record the result, then show their lease
 * page, which is live.
 */
export default async function route(req: Request, res: Response) {
  session.isLoggedInOrThrow();

  let result = await fulfillCheckout(String(req.query.session_id ?? ""));

  redirect(`/tenant?done=${result}`);
}
