import { test, assert, equal, sql, File, ValidationError } from "@elements/app";
import { submitRequest, validateRequest } from "./services";
import { loginAs, makeFixture } from "#app/shared/fixtures";

function photo(name: string, contentType: string): File {
  let data = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  return new File({ name, size: data.length, contentType, data, lastModified: new Date() });
}

test("tenant maintenance", () => {
  test("a tenant files a request with photos on their own unit", () => {
    let f = makeFixture();
    loginAs(f.tenantId);

    let id = submitRequest({
      title: "Bathroom sink clogged",
      description: "Water drains very slowly since Monday.",
      urgency: "normal",
      photos: [photo("sink.jpg", "image/jpeg")],
    });

    let row = sql<{ unitId: string; photos: number }>(`
      select unitId, (select count(*)::int from maintenancePhotos where requestId = m.id) as photos
        from maintenanceRequests m where id = ${id}
    `).firstOrThrow();

    equal(row, { unitId: f.unitId, photos: 1 });
  });

  test("a file that is not a photo is refused", () => {
    let errors = validateRequest({
      title: "Broken",
      description: "It is broken in the kitchen.",
      urgency: "low",
      photos: [photo("page.html", "text/html")],
    });

    assert(errors.photos?.length === 1, `got ${JSON.stringify(errors)}`);
  });

  test("a short description is refused before anything is written", () => {
    let f = makeFixture();
    loginAs(f.tenantId);

    let threw = false;

    try {
      submitRequest({ title: "Door", description: "stuck", urgency: "normal", photos: [] });
    } catch (err) {
      threw = true;
      assert(err instanceof ValidationError, `got ${err}`);
    }

    assert(threw);
    equal(sql(`select 1 from maintenanceRequests`).all().length, 0);
  });
});
