import { Request, Response } from "@elements/app";
import { findInvite } from "./services";
import html from "./template";

export default function route(req: Request, res: Response) {
  let token = String(req.params.token ?? "");

  return new html({ token, invite: findInvite(token) ?? null });
}
