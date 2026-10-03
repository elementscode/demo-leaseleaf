import { Request, Response } from "@elements/app";
import { maintenanceComments, maintenanceRequests, requestAccessOrThrow } from "#app/shared/services/maintenance";
import html from "./template";

export default function route(req: Request, res: Response) {
  let id = req.params.id;
  let { role } = requestAccessOrThrow(id);

  return new html({
    id,
    role,
    requests: maintenanceRequests.view({ id }),
    comments: maintenanceComments.view({ requestId: id }),
  });
}
