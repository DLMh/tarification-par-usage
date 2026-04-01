import { Tarif } from "../models";

export function computePrice(
  minutes: number,
  tarif: Pick<Tarif, "pricePer15min" | "minimumPrice">
): number {
  if (minutes <= 0) return 0;

  // Condition: si < 15 minutes => 300 Ar (minimumPrice)
  if (minutes < 15) return tarif.minimumPrice;

  // Règle de trois: 15 min => 500 Ar (pricePer15min)
  return Math.round((minutes * tarif.pricePer15min) / 15);
}