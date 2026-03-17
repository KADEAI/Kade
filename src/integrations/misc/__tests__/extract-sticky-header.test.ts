
import { extractStickyHeader } from "../extract-sticky-header"

describe("extractStickyHeader", () => {
    it("finds simple class > method context", () => {
        const code = `
class Dog:
    def bark(self):
        print("Woof!")
        print("I am happy")
    def eat(self, food):
        print(f"Eating {food}")
`.trim() // trim removes leading newline so line 1 is "class Dog:"

        // Target line: "print(f"Eating {food}")" inside def eat
        // Line 1: class Dog: (indent 0)
        // Line 2: def bark... (indent 4)
        // ...
        // Line 5: def eat... (indent 4)
        // Line 6: print... (indent 8)

        // Code lines:
        // 0: class Dog:
        // 1:     def bark(self):
        // 2:         print("Woof!")
        // 3:         print("I am happy")
        // 4:     def eat(self, food):
        // 5:         print(f"Eating {food}")

        // Test target line 6 (index 5)
        const headers6 = extractStickyHeader(code, 6)
        expect(headers6).toBe("class Dog > def eat(self, food)")
    })

    it("handles nested functions", () => {
        const code = `
function outer() {
    if (true) {
        function inner() {
            console.log("here")
        }
    }
}
`.trim()
        // 0: function outer() {
        // 1:     if (true) {
        // 2:         function inner() {
        // 3:             console.log("here")

        const headers4 = extractStickyHeader(code, 4)
        // Expect: function outer() > if (true) > function inner()
        expect(headers4).toBe("function outer() > if (true) > function inner()")
    })

    it("ignores sibling blocks", () => {
        const code = `
if (a) {
    doA()
}
if (b) {
    doB()
}
`.trim()
        // 0: if (a) {
        // 1:     doA()
        // 2: }
        // 3: if (b) {
        // 4:     doB()

        const headers5 = extractStickyHeader(code, 5)
        expect(headers5).toBe("if (b)")
    })

    it("returns null for top level", () => {
        const code = "console.log('hello')"
        expect(extractStickyHeader(code, 1)).toBeNull()
    })

    it("cleaning headers", () => {
        const code = `
class A {
    void foo() {
        // ...
    }
}
`.trim()
        // 2: void foo() {

        const headers = extractStickyHeader(code, 3) // Inside foo
        expect(headers).toBe("class A > void foo()") // Trailing { removed
    })
})
