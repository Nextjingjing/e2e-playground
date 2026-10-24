// Discount rules: 10% off orders over 1000; members get 5% more; never more than 15% in total.
export function discount(total, { member = false } = {}) {
  let pct = total > 1000 ? 10 : 0;
  if (member) pct += 5;
  return Math.min(pct, 15);
}

export const priceAfterDiscount = (total, opts) => +(total * (1 - discount(total, opts) / 100)).toFixed(2);
