/**
 * Indian mobile numbers, as typed and as shown. Pure and browser-safe (no
 * crypto), so checkout and the server share one rule.
 */

/**
 * A 10-digit Indian mobile number from however it was typed ("+91 98765
 * 43210", "098765 43210"), or null when it isn't one.
 */
export function normaliseMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.replace(/^0(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/** "98•••••210": enough for the shopper to recognise, not enough to copy. */
export function maskMobile(phone: string): string {
  return phone.length === 10 ? `${phone.slice(0, 2)}•••••${phone.slice(7)}` : phone;
}
