export type WfhAllowance = {
  monthsElapsedInQuarter: number;
  allowanceAvailableToDate: number;
  usedThisQuarter: number;
  remaining: number;
  allowed: boolean;
};

/**
 * Monthly allowance accrues by two days at a time within a calendar quarter.
 * The total allowance is capped at six days per person per quarter.
 */
export function getWfhAllowance(monthsElapsedInQuarter: number, usedThisQuarter: number): WfhAllowance {
  const elapsed = Math.max(1, Math.min(3, Math.floor(monthsElapsedInQuarter)));
  const used = Math.max(0, Math.floor(usedThisQuarter));
  const allowanceAvailableToDate = Math.min(6, elapsed * 2);
  return {
    monthsElapsedInQuarter: elapsed,
    allowanceAvailableToDate,
    usedThisQuarter: used,
    remaining: Math.max(0, allowanceAvailableToDate - used),
    allowed: used < allowanceAvailableToDate && used < 6,
  };
}
