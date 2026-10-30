export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Return an inclusive, timezone-stable list of calendar date keys. */
export function getDateKeysInRange(start: string, end: string, maxDays = 31): string[] | null {
  if (!isValidDateKey(start) || !isValidDateKey(end) || end < start ||
      !Number.isInteger(maxDays) || maxDays < 1) return null;

  const cursor = new Date(start + "T12:00:00Z");
  const last = new Date(end + "T12:00:00Z");
  const dates: string[] = [];
  while (cursor <= last && dates.length <= maxDays) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates.length <= maxDays ? dates : null;
}
