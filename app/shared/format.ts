const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function money(cents: number): string {
  return dollars.format(cents / 100);
}

/** Whole-dollar rents read better without the cents. */
export function rent(cents: number): string {
  return cents % 100 === 0 ? dollars.format(cents / 100).replace(/\.00$/, "") : money(cents);
}

/** A `YYYY-MM-DD` date string, formatted without a timezone shift. */
export function day(value: string, withYear = false): string {
  let [y, m, d] = value.split("-").map(Number);

  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

export function monthName(month: string, short = false): string {
  let [y, m] = month.split("-").map(Number);

  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ordinal(n: number): string {
  let suffix = ["th", "st", "nd", "rd"];
  let v = n % 100;

  return n + (suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]);
}

export function when(date: Date): string {
  let seconds = Math.round((Date.now() - +date) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  let minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  let hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  let days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
