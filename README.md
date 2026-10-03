![Leaseleaf, a property management app built with Elements: the landlord's October rent roll with collected, due and late totals and each unit's paid or due status.](https://elements.dev/demos/01a0f459-5f58-791f-8308-3a4551b6f012/poster?v=9af5ace84a5b)

# Leaseleaf

> A demo app built with [Elements](https://elements.dev).

Tenants pay rent by card or autopay and report repairs with photos. The landlord sees a live rent roll and a repair queue.

**Demo:** [Leaseleaf](https://elements.dev/demos/01a0f459-5f58-791f-8308-3a4551b6f012)

## Agent specs

- **Agent:** Claude Code, Opus 5.5 Medium
- **Time:** 27 min
- **Cost:** $9.27 at API rates, September 2026

## Get started

```bash
elements create leaseleaf -scaffold=elementscode/demo-leaseleaf
```

## Demo accounts

The seed creates a landlord, two buildings (Alder Court and Birch House) with
eight units, seven tenants, three months of rent payments with two tenants
behind, and a maintenance queue with photos and comments. Every date is
relative to the day the seed runs. Every account's password is `leaseleaf`,
and the sign-in page lists them.

| Email                  | Role     | Unit              |
| ---------------------- | -------- | ----------------- |
| dana@leaseleaf.test    | landlord |                   |
| priya@leaseleaf.test   | tenant   | Alder Court 1A    |
| marcus@leaseleaf.test  | tenant   | Alder Court 1B    |
| elena@leaseleaf.test   | tenant   | Alder Court 2A    |
| tom@leaseleaf.test     | tenant   | Alder Court 2B    |
| hannah@leaseleaf.test  | tenant   | Birch House 101   |
| sam@leaseleaf.test     | tenant   | Birch House 102   |
| grace@leaseleaf.test   | tenant   | Birch House 201   |

Birch House 202 is vacant, so the landlord can try inviting a tenant.

## Payments

Rent is paid through Stripe Checkout, and autopay charges a saved card.
Without a key, payments run through the built-in test checkout: the pay and
autopay buttons open a page inside the app that records the payment the same
way Stripe does, receipt and live rent roll included, with no card fields.
For real Stripe Checkout, create a free sandbox at
[dashboard.stripe.com/register](https://dashboard.stripe.com/register) and set
its secret key as `STRIPE_SECRET_KEY` in `config/env/development.env`. In the
sandbox, pay with card `4242 4242 4242 4242`. Production requires the key and
registers its own webhook the first time a tenant pays.

Rent reminders go out three days before rent is due and late notices the day
after, from a daily job at 9am. In development, emails are written to
`.elements/logs/job.log`.

## How it's built

Leaseleaf needed a live rent roll, rent by card and autopay, a maintenance queue with photos and comments, tenant invites, and scheduled reminder emails. Each of those is a part of Elements, so the agent spent its 27 minutes on the property app itself.

### What Elements gave the app

- **Live rent and maintenance.** Rent charges, maintenance requests and their comments are LiveTables, so a payment shows as paid on the landlord's rent roll the moment it lands, and a tenant sees a request move to scheduled or done as the landlord changes it.

- **Rent by card and autopay.** A tenant pays a month's rent through Stripe or saves a card for autopay, each with one `@rpc` call. Payments are recorded once whether the return page or Stripe's webhook arrives first. Until a Stripe key is set, the pay button opens a test checkout inside the app that records rent the same way, and in production the app registers its own webhook the first time a tenant pays.

- **One daily job.** A one-line cron schedule runs the rent cycle every morning at 9: it creates the month's charges, charges autopay cards on the due date, and emails a reminder three days before and a late notice the day after, each once.

- **Maintenance updates by email.** Only the landlord changes a request's status, and each change emails the tenant. Tenants attach photos when they file a request.

- **Invites and sessions.** The landlord invites a tenant by email, and accepting the invite sets a password, starts the lease and creates the first charge in one step. Landlord and tenant pages each check the signed-in role.

- **Data from SQL files.** Migrations define the app and seed a landlord, two buildings with eight units, seven tenants, three months of rent with two tenants behind, and a maintenance queue with photos.

### What the project server gave the agent

The project server runs alongside the agent and answers as soon as a file is saved: it type-checks the templates, TypeScript and SQL, applies migrations and reruns the tests, so every question came back right away and the agent kept building.

### What shipped

The app type-checks with zero errors and all 35 tests pass. Every page works on desktop and phone. A real sandbox payment went through Stripe end to end.

**Demo:** [Leaseleaf](https://elements.dev/demos/01a0f459-5f58-791f-8308-3a4551b6f012)

## License

MIT. See [LICENSE](LICENSE).
