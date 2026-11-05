const dateFormatter = (lang, options) => new Intl.DateTimeFormat(lang, { ...options, timeZone: "UTC" });

export function monthGrid(dates, monthIso, lang) {
  const [year, month] = monthIso.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const title = dateFormatter(lang, { month: "long", year: "numeric" }).format(first);
  const monday = new Date(Date.UTC(2024, 0, 1, 12));
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return dateFormatter(lang, { weekday: "short" }).format(day);
  });
  const marksByDate = new Map();
  for (const item of dates) {
    if (!marksByDate.has(item.date)) marksByDate.set(item.date, []);
    marksByDate.get(item.date).push({ kind: item.kind, paid: item.paid, label: item.label });
  }
  const offset = (first.getUTCDay() + 6) % 7;
  const weeks = [];
  let week = [];
  for (let index = 0; index < offset + daysInMonth; index++) {
    const day = index - offset + 1;
    if (day < 1 || day > daysInMonth) week.push({ day: null, date: null, marks: [] });
    else {
      const date = `${monthIso}-${String(day).padStart(2, "0")}`;
      week.push({ day, date, marks: marksByDate.get(date) || [] });
    }
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push({ day: null, date: null, marks: [] });
    weeks.push(week);
  }
  return { title, weekdays, weeks };
}
