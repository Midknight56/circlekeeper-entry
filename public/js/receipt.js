import { words } from "/js/i18n.js";
import { checkBook } from "/js/book-check.js";
import { money } from "/js/ui.js";

const params = new URLSearchParams(location.search);
const circleId = params.get("c") || "";
const key = params.get("k") || "";
const roundNumber = Number(params.get("r"));
const response = await fetch(`/api/circles/${encodeURIComponent(circleId)}/state?k=${encodeURIComponent(key)}`);
if (!response.ok) throw new Error("This link is not valid for this circle.");
const state = await response.json();
const member = state.viewer.role === "member" ? state.circle.members.find((item) => item.id === state.viewer.memberId) : null;
const lang = member && ["en", "es", "fr"].includes(member.lang) ? member.lang : "en";
const t = words[lang];
const receipts = state.receipts || [];
const receipt = receipts.find((item) => item.round === roundNumber) || receipts.at(-1);
const title = document.querySelector("#title");
const delta = document.querySelector("#delta");
const reason = document.querySelector("#reason");
const lineBox = document.querySelector("#lines");
const result = document.querySelector("#result");
document.documentElement.lang = lang;
document.title = t.receiptTitle;
title.textContent = `${t.receiptTitle} ${receipt ? receipt.round : ""}`;
document.querySelector("#check").textContent = t.checkBook;
document.querySelector("#back").textContent = t.receiptBack;
if (!receipt) {
  delta.textContent = "";
  reason.textContent = t.missingReceipt;
  document.querySelector("#check").disabled = true;
} else {
  delta.textContent = t.deltaLabel(money(receipt.deltaCents, lang));
  reason.textContent = receipt.deltaCents === 0 ? "" : t.deltaMismatch;
  if (receipt.deltaCents !== 0) delta.classList.add("error");
  for (const line of receipt.lines) {
    const row = document.createElement("div");
    row.className = "row between";
    if (line.kind === "share") {
      const name = state.circle.members.find((item) => item.id === line.memberId)?.name || line.memberId;
      row.textContent = line.cents === undefined ? t.privateShare(name, line.paid) : t.receiptShare(name, line.invoiceId || "No invoice id", money(line.cents, lang), t.paymentMethod(line.method));
    }
    else if (line.kind === "pot") row.textContent = t.receiptPot(line.payoutBatchId || "No batch id", line.itemStatus || "No item status", money(line.cents, lang));
    else row.textContent = t.receiptDelta(money(line.moneyInCents, lang), money(line.moneyOutCents, lang), money(line.cents, lang));
    lineBox.append(row);
  }
  document.querySelector("#hash").textContent = `SHA-256 ${receipt.hash}`;
  if (receipts.some((item) => item.redacted)) {
    document.querySelector("#check").disabled = true;
    result.textContent = t.privateBook;
    document.querySelector("#hash").textContent = "";
  }
}
document.querySelector("#check").addEventListener("click", async () => {
  const checked = await checkBook(receipts);
  result.className = checked.ok ? "paid" : "error";
  result.textContent = checked.ok ? t.bookPass : t.bookFail(checked.round);
});
