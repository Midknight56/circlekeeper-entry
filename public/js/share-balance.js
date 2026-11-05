// A missing invoice balance is still unresolved even if every remaining part is paid.
export function balanceLines(share, lang = "en") {
  if (!share || !(share.balanceCents > 0) || !share.recoveryError &&
      (share.parts || []).some((p) => p.status !== "CANCELLED" && !["PAID", "MARKED_AS_PAID", "COMPLETED"].includes(p.status))) return [];
  const amount = new Intl.NumberFormat(lang, { style: "currency", currency: "USD" }).format(share.balanceCents / 100);
  const labels = {
    en: `${amount} still unresolved`,
    es: `${amount} sin resolver`,
    fr: `${amount} reste à vérifier`,
  };
  const retry = {
    en: "We are restoring the balance invoice. Check the PayPal account before paying again.",
    es: "El saldo sigue sin resolver. Revisa la cuenta de PayPal antes de volver a pagar.",
    fr: "Le solde reste à vérifier. Vérifiez le compte PayPal avant de payer à nouveau.",
  };
  return [labels[lang] || labels.en, lang === "en" && share.recoveryError ? share.recoveryError : retry[lang] || retry.en];
}
