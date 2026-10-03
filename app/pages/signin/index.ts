import { Request, Response, redirect, session, sql } from "@elements/app";
import { homeFor } from "#app/shared/services/auth";
import html, { DemoLogin } from "./template";

export default function route(req: Request, res: Response) {
  if (session.isLoggedIn()) {
    redirect(homeFor(session.getOrThrow("role")));
    return;
  }

  // The seeded accounts, so a visitor can sign in without signing up.
  let demo = sql<DemoLogin>(`
    select u.id, u.email, u.name, u.role,
           coalesce(b.name || ' · ' || un.label, 'All buildings') as place
      from users u
      left join leases l on l.tenantId = u.id and l.status = 'active'
      left join units un on un.id = l.unitId
      left join buildings b on b.id = un.buildingId
     where u.email like '%@leaseleaf.test'
     order by u.role, b.name, un.label
  `).all();

  return new html({ demo });
}
