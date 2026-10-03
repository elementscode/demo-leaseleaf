import { Request, Response } from "@elements/app";
import { landlordOrThrow } from "#app/shared/services/auth";
import { loadProperties } from "./services";
import html from "./template";

export default function route(req: Request, res: Response) {
  landlordOrThrow();

  return new html({ initial: loadProperties() });
}
