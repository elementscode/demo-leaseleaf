import { Request, Response, sql } from "@elements/app";
import { requestAccessOrThrow } from "#app/shared/services/maintenance";

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

interface Photo {
  requestId: string;
  name: string;
  contentType: string;
  hash: string;
  data: Buffer;
}

/** Serves a maintenance photo to the landlord or the tenant who filed the request. */
export default function servePhoto(req: Request, res: Response) {
  let photo = sql<Photo>(`
    select requestId, name, contentType, hash, data from maintenancePhotos where id = ${req.params.id}::uuid
  `).firstOrThrow("photo not found");

  requestAccessOrThrow(photo.requestId);

  if (req.params.hash !== photo.hash) {
    res.status(404);
    return res.end();
  }

  if (INLINE.has(photo.contentType)) {
    res.setHeader("Content-Type", photo.contentType);
  } else {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment");
  }

  // private: the bytes belong to one tenant's request, so no shared cache may hold them
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");

  return photo.data;
}
