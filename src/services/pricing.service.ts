export type ServiceType =
  | "jump_start"
  | "tire_change"
  | "fuel_delivery"
  | "lockout";

export function priceForService(serviceType: string): number {
  switch (serviceType) {
    case "jump_start":
      return 59;
    case "tire_change":
      return 79;
    case "fuel_delivery":
      return 69;
    case "lockout":
      return 89;
    default:
      return 79;
  }
}

export function platformFeeFromTotal(total: number): number {
  return Math.round(total * 0.2 * 100) / 100;
}