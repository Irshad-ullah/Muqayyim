"""Structural checks for modern_roles_v1.json. Usage: python validate_modern_roles.py modern_roles_v1.json [skill_keys.txt]
skill_keys.txt (optional): one Muqayyim skill name/alias per line; reports skills not yet in the skill list."""
import json, re, sys
VAGUE = re.compile(r"^(use|apply|manage|think|communicate|work|ensure|perform|develop|create|maintain|demonstrate|show|adapt|cooperate|assist|support)\b", re.I)
d = json.load(open(sys.argv[1])); known = None
if len(sys.argv) > 2: known = {l.strip().lower() for l in open(sys.argv[2]) if l.strip()}
err, warn, titles = [], [], set()
for r in d["roles"]:
    t = r["title"].lower()
    if t in titles: err.append(f"duplicate title {r['title']}")
    titles.add(t)
    if not re.fullmatch(r"\d{2}-\d{4}\.\d{2}", r.get("related_onet_code", "")): err.append(f"{r['id']}: bad related_onet_code")
    req = r["required_skills"]
    if not 8 <= len(req) <= 15: err.append(f"{r['id']}: {len(req)} requirements (need 8-15)")
    if not any(q["importance"] == "essential" for q in req): err.append(f"{r['id']}: no essential requirement")
    for q in req:
        if not q["evidence"]: err.append(f"{r['id']}: {q['skill']} has no evidence")
        for s in q["any_of"]:
            if VAGUE.match(s): err.append(f"{r['id']}: vague phrase '{s}'")
            if known is not None and s.lower() not in known: warn.append(f"{r['id']}: '{s}' not in skill list")
    if sum(q["importance"] == "essential" for q in req) < 3: warn.append(f"{r['id']}: fewer than 3 essential requirements (weak evidence; review)")
print("\n".join(["ERROR " + e for e in err] + ["WARN  " + w for w in warn]) or "OK")
sys.exit(1 if err else 0)
