import { Request, Response } from "@elements/app";
import { landlordOrThrow } from "#app/shared/services/auth";
import { maintenanceRequests } from "#app/shared/services/maintenance";
import html from "./template";

export default function route(req: Request, res: Response) {
  landlordOrThrow();

  return new html({ requests: maintenanceRequests.view() });
}
