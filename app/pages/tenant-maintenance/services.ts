import { File, ValidationError, FieldErrors, sql, tx } from "@elements/app";
import { tenantOrThrow } from "#app/shared/services/auth";
import { Urgency } from "#app/shared/services/maintenance";

export interface RequestForm {
  title: string;
  description: string;
  urgency: Urgency;
  photos: File[];
}

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const URGENCIES = new Set(["low", "normal", "urgent"]);

export function validateRequest(form: RequestForm): FieldErrors<RequestForm> {
  let errors: FieldErrors<RequestForm> = {};

  if (!form.title.trim()) {
    errors.title = ["Give the problem a short title."];
  } else if (form.title.length > 120) {
    errors.title = ["Keep the title under 120 characters."];
  }

  if (form.description.trim().length < 10) {
    errors.description = ["Describe what is wrong and where, so the repair can be planned."];
  }

  if (!URGENCIES.has(form.urgency)) {
    errors.urgency = ["Pick how urgent it is."];
  }

  if (form.photos.length > MAX_PHOTOS) {
    errors.photos = [`Attach up to ${MAX_PHOTOS} photos.`];
  }

  for (let photo of form.photos) {
    if (!ALLOWED.has(photo.contentType)) {
      errors.photos = [`${photo.name} is not a photo. Use JPEG, PNG, GIF or WebP.`];
    } else if (photo.size > MAX_PHOTO_BYTES) {
      errors.photos = [`${photo.name} is over 8 MB.`];
    }
  }

  return errors;
}

/** @rpc */
export function submitRequest(form: RequestForm): string {
  let tenantId = tenantOrThrow();
  let errors = validateRequest(form);

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  let lease = sql<{ unitId: string }>(`
    select unitId from leases where tenantId = ${tenantId} and status = 'active' limit 1
  `).first();

  if (!lease) {
    throw new ValidationError("You need an active lease to file a request.");
  }

  return tx(() => {
    let request = sql<{ id: string }>(`
      insert into maintenanceRequests (unitId, tenantId, title, description, urgency)
           values (${lease.unitId}, ${tenantId}, ${form.title.trim()}, ${form.description.trim()}, ${form.urgency}::requestUrgency)
      returning id
    `).firstOrThrow();

    for (let photo of form.photos) {
      sql(`
        insert into maintenancePhotos (requestId, name, contentType, data)
             values (${request.id}, ${photo.name}, ${photo.contentType}, ${photo.data})
      `);
    }

    return request.id;
  });
}
