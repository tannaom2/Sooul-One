import { describe, expect, it } from "vitest";
import * as age from "age-encryption";
import { compareCounts, decryptBytes, encryptBytes, readIdentity, readRecipient, sha256 } from "../scripts/backup-lib.mts";

describe("backup encryption", () => {
  it("opens only with the matching private key", async () => {
    const id = await age.generateIdentity();
    const other = await age.generateIdentity();
    const plain = new TextEncoder().encode("PGDMP pretend dump contents");
    const cipher = await encryptBytes(plain, await age.identityToRecipient(id));

    expect(new TextDecoder().decode(cipher)).not.toContain("pretend dump");
    expect(sha256(await decryptBytes(cipher, id))).toBe(sha256(plain));
    await expect(decryptBytes(cipher, other)).rejects.toThrow();
  });

  it("reads keys from files with comments around them", () => {
    expect(readIdentity("# comment\n# public key: age1xyz\nAGE-SECRET-KEY-1ABC\n")).toBe("AGE-SECRET-KEY-1ABC");
    expect(readRecipient("# SooulOne backup public key\n# created today\nage1abc\n")).toBe("age1abc");
    expect(() => readIdentity("# nothing here")).toThrow(/No AGE-SECRET-KEY/);
  });
});

describe("compareCounts", () => {
  it("passes an identical restore and names every table that differs", () => {
    expect(compareCounts({ Order: 14, Product: 2 }, { Order: 14, Product: 2 })).toEqual([]);
    expect(compareCounts({ Order: 14, Product: 2, Review: 1 }, { Order: 13, Product: 2 })).toEqual([
      { table: "Order", source: 14, restored: 13 },
      { table: "Review", source: 1, restored: null },
    ]);
  });
});
