"""Fix the double-escaping in digit-check.spec.ts (heredoc mangled backslashes).

The TS source must contain the two-character escape `\\times` so the runtime
string is `\times`; the file currently holds `\times`, which TS reads as TAB.
"""

PATH = 'packages/paper/paper-foundation/tests/delivery/digit-check.spec.ts'

BS = chr(92)  # a single backslash, spelled without any escape sequence

fixes = [
    ("it('括号内先算（不误报）：$0.81" + BS + "times(4+18)=17.82$ —— 真实交付物里的正确算式'",
     "it('括号内先算（不误报）：$0.81" + BS + BS + "times(4+18)=17.82$ —— 真实交付物里的正确算式'"),
    ("digitSelfContradictionFindings('$0.81" + BS + "times(4+18)=17.82$')",
     "digitSelfContradictionFindings('$0.81" + BS + BS + "times(4+18)=17.82$')"),
    ("it('括号内先算（真错照抓）：$0.81" + BS + "times(4+18)=21.24$'",
     "it('括号内先算（真错照抓）：$0.81" + BS + BS + "times(4+18)=21.24$'"),
    ("digitSelfContradictionFindings('$0.81" + BS + "times(4+18)=21.24$')",
     "digitSelfContradictionFindings('$0.81" + BS + BS + "times(4+18)=21.24$')"),
    ("it('幂运算优先级正确：$0.9^8" + BS + "times0.9" + BS + "times0.9" + BS + "times0.9" + BS + "approx0.478$ 抓，≈0.314 不抓'",
     "it('幂运算优先级正确：$0.9^8" + BS + BS + "times0.9" + BS + BS + "times0.9" + BS + BS + "times0.9" + BS + BS + "approx0.478$ 抓，≈0.314 不抓'"),
    ("digitSelfContradictionFindings('$0.9^8" + BS + "times0.9" + BS + "times0.9" + BS + "times0.9" + BS + "approx0.478$')",
     "digitSelfContradictionFindings('$0.9^8" + BS + BS + "times0.9" + BS + BS + "times0.9" + BS + BS + "times0.9" + BS + BS + "approx0.478$')"),
    ("digitSelfContradictionFindings('$0.9^8" + BS + "times0.9" + BS + "times0.9" + BS + "times0.9" + BS + "approx0.314$')",
     "digitSelfContradictionFindings('$0.9^8" + BS + BS + "times0.9" + BS + BS + "times0.9" + BS + BS + "times0.9" + BS + BS + "approx0.314$')"),
]

with open(PATH, encoding='utf-8') as handle:
    text = handle.read()

for old, new in fixes:
    if old not in text:
        raise SystemExit('NOT FOUND: ' + old[:70])
    text = text.replace(old, new, 1)

with open(PATH, 'w', encoding='utf-8', newline='') as handle:
    handle.write(text)
print('escapes fixed')
