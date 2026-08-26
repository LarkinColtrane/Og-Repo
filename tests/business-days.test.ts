import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  businessDaysBetween,
  businessDaysInRange,
  isBusinessDay,
  isMarketHoliday,
  marketHolidays,
  parseIsoDate,
  previousBusinessDay,
} from "@/lib/calculations/business-days";

describe("business-day calendar", () => {
  it("rejects dates that do not exist", () => {
    assert.throws(() => parseIsoDate("2026-02-31"));
    assert.throws(() => parseIsoDate("2026-13-01"));
    assert.throws(() => parseIsoDate("not-a-date"));
    assert.doesNotThrow(() => parseIsoDate("2024-02-29")); // a real leap day
  });

  it("treats weekends as non-business days", () => {
    assert.equal(isBusinessDay("2026-06-12"), true);  // Friday
    assert.equal(isBusinessDay("2026-06-13"), false); // Saturday
    assert.equal(isBusinessDay("2026-06-14"), false); // Sunday
    assert.equal(isBusinessDay("2026-06-15"), true);  // Monday
  });

  it("computes Good Friday from Easter", () => {
    // Easter Sunday 2026 falls on 5 April, so Good Friday is 3 April.
    assert.equal(isMarketHoliday("2026-04-03"), true);
    assert.equal(isMarketHoliday("2025-04-18"), true); // Easter 2025: 20 April
  });

  it("includes the fixed and floating Canadian market holidays", () => {
    const h = marketHolidays(2026);
    assert.ok(h.has("2026-01-01"), "New Year's Day");
    assert.ok(h.has("2026-02-16"), "Family Day, 3rd Monday of February");
    assert.ok(h.has("2026-05-18"), "Victoria Day, Monday before 25 May");
    assert.ok(h.has("2026-07-01"), "Canada Day");
    assert.ok(h.has("2026-08-03"), "Civic Holiday, 1st Monday of August");
    assert.ok(h.has("2026-09-07"), "Labour Day");
    assert.ok(h.has("2026-10-12"), "Thanksgiving, 2nd Monday of October");
    assert.ok(h.has("2026-12-25"), "Christmas Day");
  });

  it("moves a weekend holiday to the following Monday", () => {
    // 1 July 2028 is a Saturday, so Canada Day is observed on Monday the 3rd.
    assert.ok(marketHolidays(2028).has("2028-07-03"));
  });

  it("counts business days, not calendar days", () => {
    // Friday to Saturday and Friday to Sunday are both zero business days.
    assert.equal(businessDaysBetween("2026-06-12", "2026-06-13"), 0);
    assert.equal(businessDaysBetween("2026-06-12", "2026-06-14"), 0);
    assert.equal(businessDaysBetween("2026-06-12", "2026-06-15"), 1);
    assert.equal(businessDaysBetween("2026-06-12", "2026-06-19"), 5);
    assert.equal(businessDaysBetween("2026-06-15", "2026-06-12"), 0); // reversed
  });

  it("skips a holiday when counting", () => {
    // Canada Day 2026 is Wednesday 1 July: Tue 30 Jun → Thu 2 Jul is one day.
    assert.equal(businessDaysBetween("2026-06-30", "2026-07-02"), 1);
  });

  it("finds the previous business day across a weekend", () => {
    assert.equal(previousBusinessDay("2026-06-14"), "2026-06-12"); // Sunday → Friday
    assert.equal(previousBusinessDay("2026-06-12"), "2026-06-12"); // already one
    assert.equal(previousBusinessDay("2026-07-01"), "2026-06-30"); // Canada Day
  });

  it("enumerates only business days in a range", () => {
    const week = businessDaysInRange("2026-06-08", "2026-06-14");
    assert.deepEqual(week, [
      "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12",
    ]);
  });
});
