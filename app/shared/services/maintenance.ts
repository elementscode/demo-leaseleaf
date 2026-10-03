import { LiveTable, ForbiddenError, NotFoundError, ValidationError, session, sql } from "@elements/app";
import { MaintenanceUpdateJob } from "#app/jobs/maintenance-update";

export type Urgency = "low" | "normal" | "urgent";
export type RequestStatus = "new" | "scheduled" | "done";

export interface PhotoRef {
  id: string;
  hash: string;
}

export interface RequestRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  unitId: string;
  tenantId: string;
  title: string;
  description: string;
  urgency: Urgency;
  status: RequestStatus;
  scheduledFor: string | null;
  completedAt: Date | null;
  tenantName: string;
  unitLabel: string;
  buildingName: string;
  photos: PhotoRef[];
  commentCount: number;
}

export interface CommentRow {
  id: string;
  createdAt: Date;
  requestId: string;
  authorId: string;
  authorName: string;
  authorRole: "landlord" | "tenant";
  body: string;
}

export const STATUSES: RequestStatus[] = ["new", "scheduled", "done"];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  new: "New",
  scheduled: "Scheduled",
  done: "Done",
};

export const URGENCY_LABEL: Record<Urgency, string> = {
  low: "Low",
  normal: "Normal",
  urgent: "Urgent",
};

export function photoUrl(photo: PhotoRef): string {
  return `/photos/${photo.id}/${photo.hash}`;
}

/**
 * The signed-in user may read and comment on a request when they are the
 * landlord or the tenant who filed it. Returns who they are.
 */
export function requestAccessOrThrow(requestId: string): { userId: string; role: "landlord" | "tenant" } {
  session.isLoggedInOrThrow();

  let userId = session.getOrThrow("userId");
  let row = sql<{ role: "landlord" | "tenant"; owns: boolean }>(`
    select u.role::text as role,
           exists (select 1 from maintenanceRequests m where m.id = ${requestId}::uuid and m.tenantId = u.id) as owns
      from users u
     where u.id = ${userId}
  `).first();

  if (!row) {
    throw new ForbiddenError();
  }

  let exists = !sql(`select 1 from maintenanceRequests where id = ${requestId}::uuid`).empty();
  if (!exists) {
    throw new NotFoundError("That request does not exist.");
  }

  if (row.role !== "landlord" && !row.owns) {
    throw new ForbiddenError("That request belongs to another tenant.");
  }

  return { userId, role: row.role };
}

function selectRequests(p: Partial<RequestRow>) {
  return sql<RequestRow>(`
    select m.id, m.createdAt, m.updatedAt, m.unitId, m.tenantId, m.title, m.description,
           m.urgency::text as urgency, m.status::text as status,
           to_char(m.scheduledFor, 'YYYY-MM-DD') as scheduledFor, m.completedAt,
           u.name as tenantName, un.label as unitLabel, b.name as buildingName,
           coalesce((select json_agg(json_build_object('id', p.id, 'hash', p.hash) order by p.createdAt)
                       from maintenancePhotos p where p.requestId = m.id), '[]'::json) as photos,
           (select count(*)::int from maintenanceComments c where c.requestId = m.id) as commentCount
      from maintenanceRequests m
      join users u on u.id = m.tenantId
      join units un on un.id = m.unitId
      join buildings b on b.id = un.buildingId
     where (${p.tenantId ?? null}::uuid is null or m.tenantId = ${p.tenantId ?? null}::uuid)
       and (${p.id ?? null}::uuid is null or m.id = ${p.id ?? null}::uuid)
  `);
}

/**
 * The maintenance queue. The landlord moves a request between statuses through
 * a view; tenants file them through the `submitRequest` rpc, which carries
 * photos. A trigger broadcasts every write, including new photos and comments,
 * which change the counts on a card.
 */
export let maintenanceRequests: LiveTable<RequestRow> = new LiveTable<RequestRow>({
  channel: (partition) => (partition ? `maintenanceRequests:${partition}` : "maintenanceRequests"),

  select: (p) => selectRequests(p),

  insert: () => {
    throw new ForbiddenError("File a request with the form.");
  },

  update: (item) => {
    let { role } = requestAccessOrThrow(item.id);

    if (role !== "landlord") {
      throw new ForbiddenError("Only the landlord changes a request's status.");
    }

    if (!STATUSES.includes(item.status)) {
      throw new ValidationError("Unknown status.");
    }

    let before = sql<{ status: RequestStatus; scheduledFor: string | null }>(`
      select status::text as status, to_char(scheduledFor, 'YYYY-MM-DD') as scheduledFor
        from maintenanceRequests where id = ${item.id}
    `).firstOrThrow();

    let scheduledFor = item.status === "new" ? null : item.scheduledFor || null;

    sql(`
      update maintenanceRequests
         set status = ${item.status}::requestStatus,
             scheduledFor = ${scheduledFor}::date,
             completedAt = case when ${item.status} = 'done' then coalesce(completedAt, now()) end
       where id = ${item.id}
    `);

    if (before.status !== item.status || (item.status === "scheduled" && before.scheduledFor !== scheduledFor)) {
      new MaintenanceUpdateJob({ requestId: item.id, kind: "status", commentId: "" }).schedule();
    }

    return selectRequests({ id: item.id }).firstOrThrow();
  },

  delete: () => {
    throw new ForbiddenError("Requests are closed, not deleted.");
  },
});

export let maintenanceComments: LiveTable<CommentRow> = new LiveTable<CommentRow>({
  channel: (partition) => (partition ? `maintenanceComments:${partition}` : "maintenanceComments"),

  select: (p) => sql<CommentRow>(`
    select id, createdAt, requestId, authorId, authorName, authorRole::text as authorRole, body
      from maintenanceComments
     where requestId = ${p.requestId ?? null}::uuid
  `),

  insert: (item) => {
    let { userId, role } = requestAccessOrThrow(item.requestId!);
    let body = (item.body ?? "").trim();

    if (!body) {
      throw new ValidationError("Write a comment first.");
    }

    if (body.length > 4000) {
      throw new ValidationError("Keep comments under 4,000 characters.");
    }

    let row = sql<CommentRow>(`
      insert into maintenanceComments (id, requestId, authorId, authorName, authorRole, body)
      select ${item.id}, ${item.requestId}, u.id, u.name, u.role, ${body}
        from users u where u.id = ${userId}
      returning id, createdAt, requestId, authorId, authorName, authorRole::text as authorRole, body
    `).firstOrThrow();

    if (role === "landlord") {
      new MaintenanceUpdateJob({ requestId: row.requestId, kind: "comment", commentId: row.id }).schedule();
    }

    return row;
  },

  update: () => {
    throw new ForbiddenError("Comments cannot be edited.");
  },

  delete: () => {
    throw new ForbiddenError("Comments cannot be deleted.");
  },
});
