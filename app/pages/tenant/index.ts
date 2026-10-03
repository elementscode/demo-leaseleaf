import { Request, Response } from "@elements/app";
import { tenantOrThrow } from "#app/shared/services/auth";
import { rentCharges } from "#app/shared/services/rent";
import { maintenanceRequests } from "#app/shared/services/maintenance";
import { testCheckout } from "#app/shared/stripe";
import { currentLease } from "./services";
import html from "./template";

export default function route(req: Request, res: Response) {
  let tenantId = tenantOrThrow();
  let lease = currentLease(tenantId) ?? null;

  return new html({
    lease,
    charges: lease ? rentCharges.view({ leaseId: lease.id }) : null,
    requests: maintenanceRequests.view({ tenantId }),
    testMode: testCheckout(),
    done: String(req.query.done ?? ""),
  });
}
