import { Request, Response } from "@elements/app";
import { tenantOrThrow } from "#app/shared/services/auth";
import { maintenanceRequests } from "#app/shared/services/maintenance";
import html from "./template";

export default function route(req: Request, res: Response) {
  let tenantId = tenantOrThrow();

  return new html({ requests: maintenanceRequests.view({ tenantId }) });
}
