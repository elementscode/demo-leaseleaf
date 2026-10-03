import { Job, email } from "@elements/app";
import { chargeNotice } from "#app/shared/services/notices";
import { monthName, money } from "#app/shared/format";
import ReceiptEmail from "#app/emails/receipt";

export interface SendReceiptJobFields {
  chargeId: string;
}

const METHOD: Record<string, string> = {
  card: "card",
  autopay: "autopay",
  check: "check",
  cash: "cash",
  transfer: "bank transfer",
};

export class SendReceiptJob extends Job<SendReceiptJobFields> {
  static maxAttempts = 5;

  run() {
    let n = chargeNotice(this.fields.chargeId);

    if (!n || n.status !== "paid" || !n.paidAt) {
      return;
    }

    email({
      to: n.tenantEmail,
      subject: `Receipt: ${monthName(n.month)} rent`,
      body: new ReceiptEmail({
        tenantName: n.tenantName.split(" ")[0],
        amount: money(n.amountCents),
        month: monthName(n.month),
        place: n.place,
        paidAt: n.paidAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        method: METHOD[n.method ?? "card"] ?? n.method ?? "card",
      }),
    });
  }
}
