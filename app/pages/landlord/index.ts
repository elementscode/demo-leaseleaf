import { Request, Response } from "@elements/app";
import { landlordOrThrow } from "#app/shared/services/auth";
import { rentCharges } from "#app/shared/services/rent";
import { defaultMonth } from "./services";
import html from "./template";

export default function route(req: Request, res: Response) {
  landlordOrThrow();

  let month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : defaultMonth();

  return new html({ charges: rentCharges.view(), month });
}
