// Written calendar days keep their day and optional year when compared with stored dates.
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-‐‑]/g, " ");
const dayWords = new Map<string, number>();
for (const words of [
  "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty first|twenty second|twenty third|twenty fourth|twenty fifth|twenty sixth|twenty seventh|twenty eighth|twenty ninth|thirtieth|thirty first",
  "uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintitres|veinticuatro|veinticinco|veintiseis|veintisiete|veintiocho|veintinueve|treinta|treinta y uno",
  "un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix sept|dix huit|dix neuf|vingt|vingt et un|vingt deux|vingt trois|vingt quatre|vingt cinq|vingt six|vingt sept|vingt huit|vingt neuf|trente|trente et un",
]) words.split("|").forEach((word, i) => dayWords.set(word, i + 1));
dayWords.set("premier", 1);
dayWords.set("primero", 1);
const dayPattern = `(?:[0-9]{1,2}(?:st|nd|rd|th|er|º|o)?(?![0-9])|${[...dayWords.keys()].sort((a, b) => b.length - a.length).join("|")})`;
const afterDay = new RegExp(`^\\s+(${dayPattern})(?![\\p{L}\\p{N}])(?:(?:\\s*,\\s*|\\s+)(?:de\\s+)?([0-9]{4})(?![0-9]))?`, "u");
const beforeDay = new RegExp(`(?<![\\p{L}\\p{N}])(${dayPattern})\\s+(?:(?:of|de)\\s+)?$`, "u");
const afterYear = /^\s+(?:de\s+)?([0-9]{4})(?![0-9])/u;

export function writtenDate(sentence: string, start: number, monthWord: string, mm: string) {
  const wordEnd = start + monthWord.length;
  const endMonth = wordEnd + (sentence[wordEnd] === "." ? 1 : 0);
  const after = afterDay.exec(plain(sentence.slice(endMonth)));
  const before = beforeDay.exec(plain(sentence.slice(0, start)));
  const dayMatch = after || before;
  if (dayMatch) {
    const day = dayWords.get(dayMatch[1]) ?? Number.parseInt(dayMatch[1], 10);
    const yearMatch = before ? afterYear.exec(plain(sentence.slice(endMonth))) : undefined;
    const year = after?.[2] || yearMatch?.[1];
    const from = before ? before.index : start;
    const end = after ? endMonth + after[0].length : endMonth + (yearMatch?.[0].length || 0);
    const date = new Date(Date.UTC(Number(year || 2000), Number(mm) - 1, day));
    const valid = date.getUTCMonth() === Number(mm) - 1 && date.getUTCDate() === day;
    return { start: from, end, raw: sentence.slice(from, end), value: valid ? `${year || "--"}-${mm}-${String(day).padStart(2, "0")}` : "invalid date" };
  }
  const year = afterYear.exec(plain(sentence.slice(endMonth)));
  const end = year ? endMonth + year[0].length : wordEnd;
  return { start, end, raw: sentence.slice(start, end), value: year ? `${year[1]}-${mm}` : mm };
}
