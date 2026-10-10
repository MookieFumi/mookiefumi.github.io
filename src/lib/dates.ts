// Fechas en español. Las fechas de los posts no llevan hora y se leen como medianoche UTC, así que se formatean en
// UTC para que nunca salga el día anterior.
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function formatDate(date: Date, { short = false } = {}): string {
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return short ? `${day} ${month.slice(0, 3)} ${year}` : `${day} de ${month} de ${year}`;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
