import { formatTutar as formatAmount } from "../../lib/data.js";

/**
 * `.jsk` ifadelerinde fonksiyon çağrısı olmadığı için tutar biçimlendirme
 * bileşen olarak sunulur: `<FormatTutar :amount="siparis.tutar" />`.
 *
 * @param {{ amount: number }} props
 * @returns {string}
 */
export function formatTutar({ amount }) {
  return formatAmount(amount);
}
