const prices: Record<string, number> = {
  tow: 7500,
  tire: 5000,
  lockout: 7500,
  fuel: 5000,
  jumpstart: 5000,
};

export function getQuotedService(service: unknown) {
  const value = String(service || "").trim().toLowerCase();
  const key = value.includes("tire") || value.includes("flat") ? "tire"
    : value.includes("lock") ? "lockout"
    : value.includes("fuel") || value.includes("gas") ? "fuel"
    : value.includes("jump") || value.includes("battery") ? "jumpstart"
    : value.includes("tow") ? "tow" : "";
  return key ? { serviceType: key, amountCents: prices[key] } : null;
}
