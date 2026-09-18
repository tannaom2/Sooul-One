#!/usr/bin/env python3
"""
Structural check for prisma/schema.prisma: every relation must be declared on
both sides. This is the specific failure class corrected in the schema header,
and `prisma validate` cannot run in this container (engine CDN is blocked),
so the invariant is checked directly.
"""
import re
import sys
from collections import defaultdict

SCHEMA = sys.argv[1] if len(sys.argv) > 1 else "soulone-platform/prisma/schema.prisma"
src = open(SCHEMA, encoding="utf-8").read()

# Strip comments so they can't create phantom matches.
src_nc = "\n".join(
    line for line in src.splitlines() if not line.strip().startswith(("//", "///"))
)

models = dict(re.findall(r"\bmodel\s+(\w+)\s*\{(.*?)\n\}", src_nc, re.S))
enums = set(re.findall(r"\benum\s+(\w+)\s*\{", src_nc))
scalars = {
    "String", "Int", "Float", "Boolean", "DateTime", "Decimal", "Json", "Bytes", "BigInt",
}

print(f"models found: {len(models)}  enums: {len(enums)}\n")

# field -> (name, type, is_list, is_optional, has_relation_attr)
relation_fields = defaultdict(list)
for model, body in models.items():
    for raw in body.splitlines():
        line = raw.split("//")[0].strip()
        if not line or line.startswith("@@"):
            continue
        m = re.match(r"^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$", line)
        if not m:
            continue
        fname, ftype, is_list, is_opt, rest = m.groups()
        if ftype in scalars or ftype in enums or ftype not in models:
            continue
        relation_fields[model].append(
            {
                "name": fname,
                "target": ftype,
                "list": bool(is_list),
                "optional": bool(is_opt),
                "owning": "@relation(" in rest and "fields:" in rest,
            }
        )

errors, pairs = [], 0
for model, fields in relation_fields.items():
    for f in fields:
        target = f["target"]
        back = [g for g in relation_fields.get(target, []) if g["target"] == model]
        if not back:
            errors.append(
                f"  {model}.{f['name']} -> {target}  (NO back-relation on {target})"
            )
        else:
            pairs += 1

# Owning side must exist exactly once per relation pair.
for model, fields in relation_fields.items():
    for f in fields:
        if f["owning"] and f["list"]:
            errors.append(f"  {model}.{f['name']} is a list AND declares fields: — invalid")

print(f"relation endpoints checked: {pairs}")
if errors:
    print("\nUNPAIRED / INVALID RELATIONS:")
    print("\n".join(errors))
    sys.exit(1)
print("\nOK — every relation is declared on both sides.")
