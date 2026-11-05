// Convert the guard response into the English copy shown on the organiser board.
export function guardRows(rows) {
  return rows.map((row) => ({
    attack: row.attack.en,
    tried: row.tried.en,
    stoppedBy: row.stoppedBy.en,
    paypalWrites: row.paypalWrites,
    result: row.resultText?.en || ({ stopped: "stopped", not_stopped: "not stopped", not_exercised: "not exercised" })[row.result],
    attempted: row.attempted,
  }));
}
