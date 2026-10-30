import { describe, expect, it } from "vitest";
import { buildReportCsv } from "@/lib/report-csv";

const row = {
  id: "assignment-1",
  caseNumber: "CASE-1",
  kind: "FE",
  engineer: "Alice",
  scheduledStartAt: "2026-11-02T04:30:00.000Z",
  status: "Completed",
  lateOrMissed: false,
  manual: false,
  notes: "",
};

describe("buildReportCsv", () => {
  it("writes a stable header and quotes commas, quotes, and line breaks", () => {
    const csv = buildReportCsv([{
      ...row,
      engineer: "Alice, Inc.",
      notes: 'Customer said "ready", then left\nFollow-up required',
    }]);

    expect(csv).toBe([
      '"Assignment","Case","Type","Engineer","Scheduled","Status","Late/missed","Manual","Notes"',
      '"assignment-1","CASE-1","FE","Alice, Inc.","2026-11-02T04:30:00.000Z","Completed","No","No","Customer said ""ready"", then left\nFollow-up required"',
    ].join("\n"));
  });

  it("neutralizes spreadsheet formula injection in user-controlled fields", () => {
    const csv = buildReportCsv([{
      ...row,
      caseNumber: "=HYPERLINK(\"https://example.test\",\"open\")",
      engineer: "@SUM(1,1)",
      notes: "\t=cmd|' /C calc'!A0",
    }]);

    expect(csv).toContain('"\'=HYPERLINK(');
    expect(csv).toContain('"\'@SUM');
    expect(csv).toContain('"\'\t=cmd');
  });

  it("returns only the header when there are no report rows", () => {
    expect(buildReportCsv([])).toBe(
      '"Assignment","Case","Type","Engineer","Scheduled","Status","Late/missed","Manual","Notes"',
    );
  });
});
