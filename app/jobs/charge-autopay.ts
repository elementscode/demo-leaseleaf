import { Job } from "@elements/app";
import { chargeAutopay } from "#app/shared/payments";

export interface ChargeAutopayJobFields {
  chargeId: string;
}

/** Charges a saved card for one month's rent. Never retried: a retry could charge twice. */
export class ChargeAutopayJob extends Job<ChargeAutopayJobFields> {
  static maxAttempts = 1;

  async run() {
    await chargeAutopay(this.fields.chargeId);
  }
}
