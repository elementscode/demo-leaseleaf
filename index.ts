import { App, getEnv, redirect, session } from "@elements/app";
import { RentCycleJob } from "#app/jobs/rent-cycle";
import config from "#config";
import { homeFor } from "#app/shared/services/auth";
import { stripeConfigured } from "#app/shared/stripe";
import signin from "#app/pages/signin";
import landlord from "#app/pages/landlord";
import properties from "#app/pages/properties";
import landlordMaintenance from "#app/pages/landlord-maintenance";
import invite from "#app/pages/invite";
import tenant from "#app/pages/tenant";
import tenantMaintenance from "#app/pages/tenant-maintenance";
import request from "#app/pages/request";
import checkoutTest from "#app/pages/checkout-test";
import checkoutReturn from "#app/routes/checkout-return";
import stripeWebhook from "#app/routes/stripe-webhook";
import servePhoto from "#app/routes/photos";
import notFound from "#app/pages/errors/not-found";
import unhandled from "#app/pages/errors/unhandled";

if (getEnv() === "production" && !stripeConfigured()) {
  throw new Error("STRIPE_SECRET_KEY is required in production.");
}

const app = new App();

app.route("/", () => {
  redirect(session.isLoggedIn() ? homeFor(session.getOrThrow("role")) : "/signin");
});

app.route("/signin", signin);
app.route("/landlord", landlord);
app.route("/landlord/properties", properties);
app.route("/landlord/maintenance", landlordMaintenance);
app.route("/invite/:token", invite);
app.route("/tenant", tenant);
app.route("/tenant/maintenance", tenantMaintenance);
app.route("/maintenance/:id", request);
app.route("/checkout/test/:kind/:id", checkoutTest);
app.route("/checkout/return", checkoutReturn);
app.route({ method: "post", path: "/stripe/webhook", handler: stripeWebhook });
app.route("/photos/:id/:hash", servePhoto);

app.cron("every day at 9am", "rent cycle", () => new RentCycleJob({}).schedule());

app.error((req, res, err) => {
  switch (err.statusCode) {
    case 401:
      redirect("/signin");
      return;

    case 404:
      return notFound(req, res, err);

    default:
      return unhandled(req, res, err);
  }
});

app.start(config);
