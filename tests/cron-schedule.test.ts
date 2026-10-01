import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every cron route has a job that calls it (launch defect D5: the referral
 * payout and box pool routes existed, but nothing ran them).
 */
const ROOT = join(__dirname, "..");

describe("scheduled jobs", () => {
  it("render.yaml calls every route under /api/cron", () => {
    const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");
    const routes = readdirSync(join(ROOT, "src/app/api/cron"));
    expect(routes.length).toBeGreaterThanOrEqual(4);
    const unscheduled = routes.filter((r) => !yaml.includes(`/api/cron/${r}\n`) && !yaml.includes(`/api/cron/${r}\r\n`));
    expect(unscheduled).toEqual([]);
  });

  it("every job carries a schedule and the shared CRON_SECRET", () => {
    const yaml = readFileSync(join(ROOT, "render.yaml"), "utf8");
    const jobs = yaml.split(/\n\s*- type: cron/).slice(1);
    expect(jobs.length).toBeGreaterThanOrEqual(4);
    for (const job of jobs) {
      expect(job).toMatch(/schedule: "[^"]+"/);
      expect(job).toMatch(/key: CRON_SECRET/);
    }
  });
});
