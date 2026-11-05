async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  const value = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Pure verifier: it only reads the displayed receipt records and returns the first mismatch.
export async function checkBook(receipts) {
  let previousHash = "";
  for (const receipt of [...receipts].sort((a, b) => a.round - b.round)) {
    if (receipt.previousHash !== previousHash) return { ok: false, round: receipt.round };
    const expected = await digest(JSON.stringify({ round: receipt.round, previousHash, lines: receipt.lines }));
    if (expected !== receipt.hash) return { ok: false, round: receipt.round };
    previousHash = expected;
  }
  return { ok: true };
}
