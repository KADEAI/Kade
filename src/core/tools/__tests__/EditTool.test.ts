import { describe, expect, it } from "vitest"

import { __editToolInternals, EditTool } from "../EditTool"

describe("EditTool line-range matching", () => {
	it("extracts exact text for the requested line range", () => {
		const fileContent = `function alpha() {
    return 1;
}

function beta() {
    return 2;
}`

		const range = __editToolInternals.getOffsetsForLineRange(fileContent, 5, 6, false)

		expect(range).not.toBeNull()
		expect(range?.text).toBe(`function beta() {
    return 2;`)
	})

	it("finds an exact normalized match near the hinted line range when line numbers drift", () => {
		const fileContent = `function drawPowerupIndicators() {
    return true;
}

if (paused) {
    return;
}

function restartGame() {
    score = 0;
    lives = 3;
    gameActive = true;
    fruits = [];
    particles = [];
    combo = 0;
    comboTimer = 0;
}`

		const searchText = `        function restartGame() {
            score = 0;
            lives = 3;
            gameActive = true;
            fruits = [];
            particles = [];
            combo = 0;
            comboTimer = 0;`

		const match = __editToolInternals.findNearbyNormalizedLineRangeMatch(
			fileContent,
			searchText,
			14,
			21,
			false,
			12,
		)

		expect(match).not.toBeNull()
		expect(match?.startLine).toBe(9)
		expect(match?.endLine).toBe(16)
		expect(match?.text).toContain("function restartGame()")
	})

	it("does not match unrelated nearby blocks", () => {
		const fileContent = `function alpha() {
  return 1;
}

function beta() {
  return 2;
}`

		const searchText = `function gamma() {
  return 3;
}`

		const match = __editToolInternals.findNearbyNormalizedLineRangeMatch(
			fileContent,
			searchText,
			1,
			3,
			false,
			6,
		)

		expect(match).toBeNull()
	})

	it("supports range-trust semantics for repetitive identical blocks", () => {
		const fileContent = `if flag:
    run()

if flag:
    run()

if flag:
    run()`

		const range = __editToolInternals.getOffsetsForLineRange(fileContent, 4, 5, false)
		const flatSearch = `if flag:
run()`

		expect(range).not.toBeNull()
		expect(
			__editToolInternals.normalizeWhitespaceForMatching(range?.text ?? ""),
		).toBe(__editToolInternals.normalizeWhitespaceForMatching(flatSearch))
		expect(range?.text).toBe(`if flag:
    run()`)
	})

	it("finds the nearby repeated block closest to the hinted range", () => {
		const fileContent = `if flag:
    run()

if flag:
    run()

if flag:
    run()`

		const match = __editToolInternals.findNearbyNormalizedLineRangeMatch(
			fileContent,
			`if flag:
run()`,
			4,
			5,
			false,
			2,
		)

		expect(match).not.toBeNull()
		expect(match?.startLine).toBe(4)
		expect(match?.text).toBe(`if flag:
    run()`)
	})
})

describe("EditTool legacy block parsing", () => {
	it("parses compact Old(14-37): headers correctly", () => {
		const tool = new EditTool()

		const result = tool.parseLegacy({
			path: "sample.ts",
			edit: `Old(14-37):
const before = true;
New:
const after = true;`,
		})

		expect(result.edit).toHaveLength(1)
		expect(result.edit[0].start_line).toBe(14)
		expect(result.edit[0].end_line).toBe(37)
		expect(result.edit[0].oldText).toBe("const before = true;")
		expect(result.edit[0].newText).toBe("const after = true;")
	})

	it("does not split content just because it contains the word new", () => {
		const tool = new EditTool()

		const result = tool.parseLegacy({
			path: "sample.ts",
			edit: `Old (10-12):
const label = "new component";
const status = "brand new";
New:
const label = "updated component";
const status = "still brand new";`,
		})

		expect(result.edit).toHaveLength(1)
		expect(result.edit[0].oldText).toContain(`const label = "new component";`)
		expect(result.edit[0].oldText).toContain(`const status = "brand new";`)
		expect(result.edit[0].newText).toContain(`const status = "still brand new";`)
	})

	it("only treats standalone New: lines as replacement headers", () => {
		const tool = new EditTool()

		const result = tool.parseLegacy({
			path: "sample.ts",
			edit: `Old (1-3):
const message = "Header words should stay literal";
const text = "New: should not split here";
New:
const text = "replacement applied";`,
		})

		expect(result.edit).toHaveLength(1)
		expect(result.edit[0].oldText).toContain(`const text = "New: should not split here";`)
		expect(result.edit[0].newText).toBe(`const text = "replacement applied";`)
	})

	it("the ULTIMATE HEADER STUFFING STRESS TEST", () => {
		const tool = new EditTool()

		const result = tool.parseLegacy({
			path: "stress.ts",
			edit: `Old (1-10):
// These should stay as literal content because they have text before/after them:
const x = "Old (1-10):";
const y = "New:";
console.log("Old (5-5): at start"); console.log("New: at end");
   New:   
// The above line was a header (ignoring whitespace), so we are now in New content.
// These should also stay literal:
const z = "Old (99-99):";
Old (100-110):
// The above was a NEW header (since Old always flushes), so we are back in Old content.
New:
// Back in New content.
`,
		})

		// 1. Initial Old (1-10) -> New (Header at line 6)
		// 2. Old (100-110) (Line 10) -> New (Header at line 12)
		expect(result.edit).toHaveLength(2)
		
		// First block
		expect(result.edit[0].start_line).toBe(1)
		expect(result.edit[0].oldText).toContain(`const x = "Old (1-10):";`)
		expect(result.edit[0].oldText).toContain(`console.log("Old (5-5): at start");`)
		
		// Second block
		expect(result.edit[1].start_line).toBe(100)
		expect(result.edit[1].oldText).toContain(`// The above was a NEW header`)
		expect(result.edit[1].newText).toContain(`// Back in New content.`)
	})

	it("The MEGA GIGA ULTIMATE HEADER STUFFING STRESS TEST", () => {
		const tool = new EditTool()
		// 100 lines that look ALMOST like headers but aren't
		const line = "Old (1-1):"
		const manyFakes = Array.from({ length: 100 }, (_, i) => 
			`console.log("${line}"); // Fake #${i}`
		).join("\n")
		
		const editContent = `Old (5-10):
${manyFakes}
New:
// replacement content here
`
		
		const result = tool.parseLegacy({ path: "test.ts", edit: editContent })
		
		// If it split incorrectly, it would have 100+ blocks
		expect(result.edit).toHaveLength(1)
		expect(result.edit[0].start_line).toBe(5)
		expect(result.edit[0].oldText).toContain(`// Fake #99`)
	})
})

describe("EditTool indentation heuristics", () => {
	it("detects the file indentation quantum", () => {
		const fileContent = `function demo() {
    if (ready) {
        return true;
    }
}`

		expect(__editToolInternals.detectIndentationQuantum(fileContent)).toBe(4)
	})

	it("detects two-space indentation styles", () => {
		const fileContent = `function demo() {
  if (ready) {
    return true;
  }
}`

		expect(__editToolInternals.detectIndentationQuantum(fileContent)).toBe(2)
	})

	it("falls back to a sane quantum for flat files", () => {
		const fileContent = `alpha()
beta()
gamma()`

		expect(__editToolInternals.detectIndentationQuantum(fileContent)).toBe(4)
	})

	it("snaps lazy one-space nesting to the file indentation grid", () => {
		const fileContent = `function demo() {
    if (target) {
        return true;
    }
}`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if (target) {
 print("Found it");
 return true;
}`,
			"    ",
			`    if (target) {
        return true;
    }`,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`    if (target) {
        print("Found it");
        return true;
    }`)
	})

	it("snaps odd three-space indentation up to the file grid", () => {
		const fileContent = `function demo() {
    if (ready) {
        return true;
    }
}`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if (ready) {
   return compute();
}`,
			"    ",
			`    if (ready) {
        return true;
    }`,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`    if (ready) {
        return compute();
    }`)
	})

	it("infers staircase nesting when replacing a nested block with flat control flow", () => {
		const fileContent = `if target:
    if ready:
        return True`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if target:
if ready:
return True`,
			"",
			`if target:
    if ready:
        return True`,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`if target:
    if ready:
        return True`)
	})

	it("preserves closing-brace dedents while staircasing nested content", () => {
		const fileContent = `if (target) {
    if (ready) {
        doThing();
    }
}`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if (target) {
if (ready) {
doThing();
}
}`,
			"",
			`if (target) {
    if (ready) {
        doThing();
    }
}`,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`if (target) {
    if (ready) {
        doThing();
    }
}`)
	})

	it("preserves else dedents instead of over-nesting them", () => {
		const fileContent = `if target:
    if ready:
        act()
    else:
        fallback()`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if target:
if ready:
act()
else:
fallback()`,
			"",
			`if target:
    if ready:
        act()
    else:
        fallback()`,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`if target:
    if ready:
        act()
    else:
        fallback()`)
	})

	it("does not invent a staircase when the original block was flat", () => {
		const fileContent = `if target:
    log()
    notify()`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if target:
log()
notify()`,
			"",
			`if target:
    log()
    notify()`,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`if target:
    log()
    notify()`)
	})

	it("preserves non-line-start edits on the first line", () => {
		const fileContent = `const message = if (ready) {
    return true;
};`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if (ready) {
 print("ok");
}`,
			"",
			`if (ready) {
    return true;
}`,
			fileContent,
			false,
			false,
		)

		expect(result).toBe(`if (ready) {
    print("ok");
}`)
	})

	it("handles tab-indented files without collapsing nested structure", () => {
		const fileContent = "if target:\n\tif ready:\n\t\treturn True"

		const result = __editToolInternals.applyIndentationHeuristics(
			`if target:
 if ready:
 return True`,
			"",
			"if target:\n\tif ready:\n\t\treturn True",
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`if target:
    if ready:
        return True`)
	})

	it("preserves CRLF output when snapping and staircasing", () => {
		const fileContent = "if target:\r\n    if ready:\r\n        return true"

		const result = __editToolInternals.applyIndentationHeuristics(
			"if target:\r\n if ready:\r\n return true",
			"",
			"if target:\r\n    if ready:\r\n        return true",
			fileContent,
			true,
			true,
		)

		expect(result).toBe("if target:\r\n    if ready:\r\n        return true")
		expect(result.includes("\r\n")).toBe(true)
	})

	it("survives a wildly repetitive boilerplate forest with nearby line drift", () => {
		const repeatedBlock = `if enabled:
    if feature:
        run()`
		const fileContent = Array.from({ length: 12 }, () => repeatedBlock).join("\n\n")

		const match = __editToolInternals.findNearbyNormalizedLineRangeMatch(
			fileContent,
			`if enabled:
if feature:
run()`,
			17,
			19,
			false,
			4,
		)

		expect(match).not.toBeNull()
		expect(match?.startLine).toBe(17)
		expect(match?.text).toBe(repeatedBlock)
	})

	it("rebuilds a deeply lazy staircase with multiple control-flow transitions", () => {
		const fileContent = `if alpha:
    if beta:
        if gamma:
            process()
        else:
            recover()
    finalize()`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if alpha:
if beta:
if gamma:
process()
else:
recover()
finalize()`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`if alpha:
    if beta:
        if gamma:
            process()
        else:
            recover()
    finalize()`)
	})

	it("does not let malformed flat dedents escape the outer anchor", () => {
		const fileContent = `if outer:
    if inner:
        act()
    cleanup()
done()`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if outer:
if inner:
act()
cleanup()
done()`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`if outer:
    if inner:
        act()
    cleanup()
done()`)
	})

	it("reconstructs a flat JSX tag pyramid", () => {
		const fileContent = `<div>
    <span>
        Content
    </span>
</div>`

		const result = __editToolInternals.applyIndentationHeuristics(
			`<div>
<span>
Content
</span>
</div>`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`<div>
    <span>
        Content
    </span>
</div>`)
	})

	it("reconstructs nested HTML siblings with closer reset", () => {
		const fileContent = `<ul>
    <li>
        Item
    </li>
    <li>
        Item 2
    </li>
</ul>`

		const result = __editToolInternals.applyIndentationHeuristics(
			`<ul>
<li>
Item
</li>
<li>
Item 2
</li>
</ul>`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`<ul>
    <li>
        Item
    </li>
    <li>
        Item 2
    </li>
</ul>`)
	})

	it("creates hanging indents for flat arrays", () => {
		const fileContent = `const list = [
    "item1",
    "item2",
];`

		const result = __editToolInternals.applyIndentationHeuristics(
			`const list = [
"item1",
"item2",
];`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`const list = [
    "item1",
    "item2",
];`)
	})

	it("resets siblings correctly after a brace closer", () => {
		const fileContent = `if (test) {
    print("child");
}
print("sibling");`

		const result = __editToolInternals.applyIndentationHeuristics(
			`if (test) {
print("child");
}
print("sibling");`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`if (test) {
    print("child");
}
print("sibling");`)
	})

	it("reconstructs flat function-call arguments", () => {
		const fileContent = `renderWidget(
    alpha,
    beta,
    gamma,
)`

		const result = __editToolInternals.applyIndentationHeuristics(
			`renderWidget(
alpha,
beta,
gamma,
)`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`renderWidget(
    alpha,
    beta,
    gamma,
)`)
	})

	it("reconstructs the user's flat JSX replacement with multiline tag props", () => {
		const fileContent = `import React from 'react';

export const App = () => {
  return (
    <div className="app">
      <section className="container">
        <div className="target-zone">
          {/* REPLACE_ME */}
        </div>
      </section>
    </div>
  );
};`

		const matchedText = `        <div className="target-zone">
          {/* REPLACE_ME */}
        </div>`

		const newBlock = `<div className="active-zone">
<header>
<h1>Architect Build Live</h1>
</header>
<ul className="logic-list">
{items.map((item) => (
<li key={item.id}
className="list-item">
<span>
{item.text}
</span>
</li>
))}
</ul>
<footer>
<p>Structural integrity verified.</p>
</footer>
</div>`

		const result = __editToolInternals.applyIndentationHeuristics(
			newBlock,
			"        ",
			matchedText,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`        <div className="active-zone">
          <header>
            <h1>Architect Build Live</h1>
          </header>
          <ul className="logic-list">
            {items.map((item) => (
              <li key={item.id}
                className="list-item">
                <span>
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
          <footer>
            <p>Structural integrity verified.</p>
          </footer>
        </div>`)
	})

	it("reconstructs a flat Rust iterator chain with nested match logic", () => {
		const fileContent = `#[derive(Debug)]
struct Processor {
    id: u32,
}

impl Processor {
    fn process_data(&self, input: Option<Vec<String>>) -> Result<String, String> {
        match input {
            Some(data) => {
                // TARGET_ZONE_START
                let x = "placeholder";
                // TARGET_ZONE_END
                Ok(format!("Processed: {}", x))
            }
            None => Err("No data".to_string()),
        }
    }
}`

		const matchedText = `                // TARGET_ZONE_START
                let x = "placeholder";
                // TARGET_ZONE_END`

		const newBlock = `let x = data.iter()
.filter(|s| !s.is_empty())
.map(|s| {
match s.parse::<i32>() {
Ok(num) => {
if num > 100 {
"large".to_string()
} else {
"small".to_string()
}
}
Err(_) => "invalid".to_string(),
}
})
.collect::<Vec<String>>()
.join(", ");`

		const result = __editToolInternals.applyIndentationHeuristics(
			newBlock,
			"                ",
			matchedText,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`                let x = data.iter()
                .filter(|s| !s.is_empty())
                .map(|s| {
                    match s.parse::<i32>() {
                        Ok(num) => {
                            if num > 100 {
                                "large".to_string()
                            } else {
                                "small".to_string()
                            }
                        }
                        Err(_) => "invalid".to_string(),
                    }
                })
                .collect::<Vec<String>>()
                .join(", ");`)
	})

	it("experimentally hoists an immediate nested JS helper out of a control block", () => {
		const fileContent = `let core_status = "stable"
let fuel_cells = [100, 80, 0, 45]
let logs = []
let _lock = false
function log(m) { logs.push({t: Date.now(), m}) }
function check_cell(i) {
    return new Promise(r => {
        setTimeout(() => {
            log("checking " + i)
            r(fuel_cells[i] > 0)
        }, Math.random() * 100)
    })
}
function emergency_shutdown() {
    core_status = "offline"
    log("SHUTDOWN")
}
async function monitor() {
    if(_lock) return
    _lock = true
    for(let i=0; i<fuel_cells.length; i++) {
        let ok = await check_cell(i)
        if(!ok) {
            function trigger_alarm() {
                console.log("ALARM CELL " + i)
                emergency_shutdown()
            }
            trigger_alarm()
        }
    }
    _lock = false
    setTimeout(monitor, 500)
}
function refuel(i, amt) {
    fuel_cells[i] += amt
    log("refueled " + i)
}
monitor()
refuel(2, 50)`

		const result = __editToolInternals.applyIndentationHeuristics(
			`let core_status = "stable"
let fuel_cells = [100, 80, 0, 45]
let logs = []
let _lock = false
function log(m) { logs.push({t: Date.now(), m}) }
function check_cell(i) {
return new Promise(r => {
setTimeout(() => {
log("checking " + i)
r(fuel_cells[i] > 0)
}, Math.random() * 100)
})
}
function emergency_shutdown() {
core_status = "offline"
log("SHUTDOWN")
}
async function monitor() {
if(_lock) return
_lock = true
for(let i=0; i<fuel_cells.length; i++) {
let ok = await check_cell(i)
if(!ok) {
function trigger_alarm() {
console.log("ALARM CELL " + i)
emergency_shutdown()
}
trigger_alarm()
}
}
_lock = false
setTimeout(monitor, 500)
}
function refuel(i, amt) {
fuel_cells[i] += amt
log("refueled " + i)
}
monitor()
refuel(2, 50)`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toContain(`for(let i=0; i<fuel_cells.length; i++) {
        let ok = await check_cell(i)
        function trigger_alarm() {`)
		expect(result).toContain(`if(!ok) {
            trigger_alarm()
        }`)
	})

	it("experimentally resets flat Python top-level declarations back to base scope", () => {
		const fileContent = `def bubble_sort(data):
    n = len(data)
    return data

def calculate_stats(numbers):
    return None`

		const result = __editToolInternals.applyIndentationHeuristics(
			`def bubble_sort(data):
n = len(data)
for i in range(n):
for j in range(0, n-i-1):
if data[j] > data[j+1]:
data[j], data[j+1] = data[j+1], data[j]
return data
def calculate_stats(numbers):
if not numbers:
return None`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`def bubble_sort(data):
    n = len(data)
    for i in range(n):
        for j in range(0, n-i-1):
            if data[j] > data[j+1]:
                data[j], data[j+1] = data[j+1], data[j]
    return data
def calculate_stats(numbers):
    if not numbers:
        return None`)
	})

	it("experimentally de-collides duplicate declarations in the same JS scope", () => {
		const fileContent = `function demo() {
    const x = 1;
    return x;
}`

		const result = __editToolInternals.applyIndentationHeuristics(
			`function demo() {
const x = 1;
const x = 2;
return x;
}`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`function demo() {
    const x = 1;
    const x_2 = 2;
    return x_2;
}`)
	})

	it("experimentally translates obvious mixed JS logging into Python logging", () => {
		const fileContent = `def process():
    print("ready")
    return True`

		const result = __editToolInternals.applyIndentationHeuristics(
			`def process():
console.log("ready")
return true`,
			"",
			fileContent,
			fileContent,
			true,
			false,
		)

		expect(result).toBe(`def process():
    print("ready")
    return True`)
	})
})
