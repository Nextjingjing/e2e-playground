import { priceAfterDiscount } from "./pricing.js";
export default function Cart({ total, member }) {
  return <p>Total: {priceAfterDiscount(total, { member })}</p>;
}
