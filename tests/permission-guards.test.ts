import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Hiding a sidebar link protects nothing: server actions and route handlers
 * are public endpoints, and pages are reachable by typing the URL. So every
 * one of them has to check a permission itself. This reads the source and
 * fails if a new action, route or page forgets to — the mistake is easy to
 * make and invisible in a normal click-through, because the UI never shows
 * the unguarded thing to someone who shouldn't use it.
 */

const ROOT = join(__dirname, "..");

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, match);
    return match(name) ? [path] : [];
  });
}

const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

// Sign-in, MFA and sign-out run before (or while ending) a session, so they
// can't require a permission. They have their own rate limiting and audit.
const PUBLIC = new Set(["src/app/admin/login/actions.ts", "src/app/admin/login/page.tsx", "src/app/admin/logout/page.tsx"]);

/** Each exported async function (server action or route handler) and its body. */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)];
  return starts.map((m, i) => ({
    name: m[1],
    body: source.slice(m.index, starts[i + 1]?.index ?? source.length),
  }));
}

const endpointFiles = [
  ...walk(join(ROOT, "src/app/admin"), (n) => n === "actions.ts"),
  ...walk(join(ROOT, "src/app/api/admin"), (n) => n === "route.ts"),
].filter((p) => !PUBLIC.has(rel(p)));

const pageFiles = walk(join(ROOT, "src/app/admin"), (n) => n === "page.tsx").filter((p) => !PUBLIC.has(rel(p)));

describe("admin endpoints check a permission before touching data", () => {
  it("finds the files it is meant to check", () => {
    expect(endpointFiles.length).toBeGreaterThanOrEqual(5);
    expect(pageFiles.length).toBeGreaterThanOrEqual(13);
  });

  for (const file of endpointFiles) {
    const source = readFileSync(file, "utf8");
    for (const fn of exportedFunctions(source)) {
      it(`${rel(file)} → ${fn.name}`, () => {
        const guard = fn.body.indexOf("requirePermission(");
        expect(guard, "calls requirePermission()").toBeGreaterThan(-1);
        const firstDb = fn.body.search(/\bdb\.\w+/);
        if (firstDb !== -1) expect(guard, "checks the permission before the first database call").toBeLessThan(firstDb);
      });
    }
  }
});

describe("admin pages check a permission", () => {
  for (const file of pageFiles) {
    it(rel(file), () => {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/requirePermission\(\s*"[a-z]+:[a-z]+"\s*\)/);
      expect(source, "renders NoAccess when the check fails").toContain("<NoAccess");
    });
  }
});
