export type ReportCsvRow = {
  id: string;
  caseNumber: string;
  kind: string;
  engineer: string;
  scheduledStartAt: string;
  status: string;
  lateOrMissed: boolean;
  manual: boolean;
  notes: string;
};

const headers = ["Assignment", "Case", "Type", "Engineer", "Scheduled", "Status", "Late/missed", "Manual", "Notes"];

function escapeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  // Spreadsheet applications may evaluate formula-like cells even when quoted.
  // Prefix dangerous values so exported user-controlled fields remain inert.
  if (/^[=+\-@]/.test(text.trimStart()) || /^[\t\r\n]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildReportCsv(rows: readonly ReportCsvRow[]): string {
  const values: unknown[][] = [
    headers,
    ...rows.map((row) => [
      row.id,
      row.caseNumber,
      row.kind,
      row.engineer,
      row.scheduledStartAt,
      row.status,
      row.lateOrMissed ? "Yes" : "No",
      row.manual ? "Yes" : "No",
      row.notes,
    ]),
  ];
  return values.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}
