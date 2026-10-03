import { Job, email, sql } from "@elements/app";
import { day } from "#app/shared/format";
import MaintenanceUpdateEmail from "#app/emails/maintenance-update";

export interface MaintenanceUpdateJobFields {
  requestId: string;
  kind: string;
  commentId: string;
}

interface RequestDetails {
  title: string;
  status: string;
  scheduledFor: string | null;
  tenantName: string;
  tenantEmail: string;
  landlordName: string;
}

/** Tells the tenant when the landlord schedules, finishes or comments on their request. */
export class MaintenanceUpdateJob extends Job<MaintenanceUpdateJobFields> {
  static maxAttempts = 5;

  run() {
    let r = sql<RequestDetails>(`
      select m.title, m.status::text as status, to_char(m.scheduledFor, 'YYYY-MM-DD') as scheduledFor,
             u.name as tenantName, u.email as tenantEmail,
             coalesce((select name from users where role = 'landlord' order by createdAt limit 1), 'Your landlord') as landlordName
        from maintenanceRequests m
        join users u on u.id = m.tenantId
       where m.id = ${this.fields.requestId}
    `).first();

    if (!r) {
      return;
    }

    let comment = "";
    let headline = "Your request was updated";

    if (this.fields.kind === "comment") {
      comment = sql<{ body: string }>(`select body from maintenanceComments where id = ${this.fields.commentId}`).first()?.body ?? "";
      headline = `${r.landlordName} replied`;
    } else if (r.status === "scheduled") {
      headline = r.scheduledFor ? `Repair scheduled for ${day(r.scheduledFor)}` : "Your repair is scheduled";
    } else if (r.status === "done") {
      headline = "Your repair is done";
    }

    email({
      to: r.tenantEmail,
      subject: `${headline}: ${r.title}`,
      body: new MaintenanceUpdateEmail({
        tenantName: r.tenantName.split(" ")[0],
        title: r.title,
        headline,
        comment,
        landlordName: r.landlordName,
        url: `/maintenance/${this.fields.requestId}`,
      }),
    });
  }
}
