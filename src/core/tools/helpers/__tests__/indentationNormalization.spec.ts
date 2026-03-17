import { describe, expect, it } from "vitest"

import {
	applyIndentationHeuristics,
	detectIndentationQuantum,
	normalizeNewFileContent,
} from "../indentationNormalization"

describe("indentationNormalization", () => {
	it("detects indentation quantum for four-space files", () => {
		const fileContent = `function demo() {
    if (ready) {
        return true;
    }
}`

		expect(detectIndentationQuantum(fileContent)).toBe(4)
	})

	it("detects indentation quantum for two-space files", () => {
		const fileContent = `function demo() {
  if (ready) {
    return true;
  }
}`

		expect(detectIndentationQuantum(fileContent)).toBe(2)
	})

	it("snaps lazy edit indentation to the file grid", () => {
		const fileContent = `function demo() {
    if (target) {
        return true;
    }
}`

		const result = applyIndentationHeuristics(
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

	it("preserves staircase intent for flat control-flow edits", () => {
		const fileContent = `if target:
    if ready:
        return True`

		const result = applyIndentationHeuristics(
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

	it("normalizes new file content using the shared creation heuristic", () => {
		const content = `function demo() {
    if (target) {
 print("Found it");
 return true;
    }
}
`

		expect(normalizeNewFileContent(content)).toBe(`function demo() {
    if (target) {
        print("Found it");
        return true;
    }
}
`)
	})

	it("repairs a catastrophically flat tsx write", () => {
		const content = String.raw`import React, { useState, useMemo } from 'react';

interface WebSearchToolProps {
tool: any;
toolResult: any;
isLastMessage: boolean;
shouldAnimate: boolean;
}

export const WebSearchTool: React.FC<WebSearchToolProps> = ({ tool, toolResult, isLastMessage, shouldAnimate }) => {
const [isExpanded, setIsExpanded] = useState(false);

const query = useMemo(() => tool.query || tool.params?.query || "", [tool]);
const allowedDomains = useMemo(() => tool.allowed_domains || tool.params?.allowed_domains || [], [tool]);
const blockedDomains = useMemo(() => tool.blocked_domains || tool.params?.blocked_domains || [], [tool]);

const results = useMemo(() => {
if (!toolResult?.content) return [];
const content = typeof toolResult.content === 'string'
? toolResult.content
: Array.isArray(toolResult.content)
? (toolResult.content.map((c: any) => c.text).join(''))
: '';

if (!content) return [];

try {
const parsed = JSON.parse(content);
if (parsed.results && Array.isArray(parsed.results)) {
return parsed.results;
}
} catch { }

const jsonMatch = content.match(/\`\`\`json\\n([\\s\\S]*?)\\n\`\`\`/) || content.match(/(\\{[\\s\\S]*\\})/);
if (jsonMatch) {
try {
const parsed = JSON.parse(jsonMatch[1]);
if (parsed.results && Array.isArray(parsed.results)) {
return parsed.results;
}
} catch { }
}

return [];
}, [toolResult]);

return (
<div className="web-search-tool">
<div className="tool-header" onClick={() => setIsExpanded(!isExpanded)}>
<span>Web Search: {query}</span>
<span>{isExpanded ? '▼' : '▶'}</span>
</div>
{isExpanded && (
<div className="tool-content">
{allowedDomains.length > 0 && (
<div>Allowed: {allowedDomains.join(', ')}</div>
)}
{blockedDomains.length > 0 && (
<div>Blocked: {blockedDomains.join(', ')}</div>
)}
<div className="results">
{results.map((result: any, idx: number) => (
<div key={idx} className="result-item">
<a href={result.url} target="_blank" rel="noopener noreferrer">
{result.title}
</a>
<p>{result.description}</p>
</div>
))}
</div>
</div>
)}
</div>
);
};`

		expect(normalizeNewFileContent(content)).toBe(String.raw`import React, { useState, useMemo } from 'react';

interface WebSearchToolProps {
    tool: any;
    toolResult: any;
    isLastMessage: boolean;
    shouldAnimate: boolean;
}

export const WebSearchTool: React.FC<WebSearchToolProps> = ({ tool, toolResult, isLastMessage, shouldAnimate }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const query = useMemo(() => tool.query || tool.params?.query || "", [tool]);
    const allowedDomains = useMemo(() => tool.allowed_domains || tool.params?.allowed_domains || [], [tool]);
    const blockedDomains = useMemo(() => tool.blocked_domains || tool.params?.blocked_domains || [], [tool]);

    const results = useMemo(() => {
        if (!toolResult?.content) return [];
        const content = typeof toolResult.content === 'string'
            ? toolResult.content
            : Array.isArray(toolResult.content)
                ? (toolResult.content.map((c: any) => c.text).join(''))
                : '';

        if (!content) return [];

        try {
            const parsed = JSON.parse(content);
            if (parsed.results && Array.isArray(parsed.results)) {
                return parsed.results;
            }
        } catch { }

        const jsonMatch = content.match(/\`\`\`json\\n([\\s\\S]*?)\\n\`\`\`/) || content.match(/(\\{[\\s\\S]*\\})/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1]);
                if (parsed.results && Array.isArray(parsed.results)) {
                    return parsed.results;
                }
            } catch { }
        }

        return [];
    }, [toolResult]);

    return (
        <div className="web-search-tool">
            <div className="tool-header" onClick={() => setIsExpanded(!isExpanded)}>
                <span>Web Search: {query}</span>
                <span>{isExpanded ? '▼' : '▶'}</span>
            </div>
            {isExpanded && (
                <div className="tool-content">
                    {allowedDomains.length > 0 && (
                        <div>Allowed: {allowedDomains.join(', ')}</div>
                    )}
                    {blockedDomains.length > 0 && (
                        <div>Blocked: {blockedDomains.join(', ')}</div>
                    )}
                    <div className="results">
                        {results.map((result: any, idx: number) => (
                            <div key={idx} className="result-item">
                                <a href={result.url} target="_blank" rel="noopener noreferrer">
                                    {result.title}
                                </a>
                                <p>{result.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};`)
	})

	it.skip("repairs a catastrophically flat nested python write", () => {
		const content = `def process_data(data):
if data:
for item in data:
if isinstance(item, dict):
for key, value in item.items():
if isinstance(value, list):
for sub_item in value:
if isinstance(sub_item, dict):
for sub_key, sub_value in sub_item.items():
if sub_key == "target":
if isinstance(sub_value, str):
if len(sub_value) > 0:
result = []
for char in sub_value:
if char.isalnum():
result.append(char.upper())
else:
result.append('_')
processed = ''.join(result)
if processed:
print(f"Found: {processed}")
return processed
elif isinstance(sub_value, int):
if sub_value > 0:
doubled = sub_value * 2
if doubled < 1000:
print(f"Doubled: {doubled}")
return doubled
else:
print("Too large")
return None
else:
print("Negative value")
return None
else:
continue
else:
continue
else:
continue
else:
continue
else:
continue
else:
continue
else:
continue
return None

data = [{"items": [{"target": "hello world"}, {"target": 42}]}]
process_data(data)`

		expect(normalizeNewFileContent(content)).toBe(`def process_data(data):
    if data:
        for item in data:
            if isinstance(item, dict):
                for key, value in item.items():
                    if isinstance(value, list):
                        for sub_item in value:
                            if isinstance(sub_item, dict):
                                for sub_key, sub_value in sub_item.items():
                                    if sub_key == "target":
                                        if isinstance(sub_value, str):
                                            if len(sub_value) > 0:
                                                result = []
                                                for char in sub_value:
                                                    if char.isalnum():
                                                        result.append(char.upper())
                                                    else:
                                                        result.append('_')
                                                processed = ''.join(result)
                                                if processed:
                                                    print(f"Found: {processed}")
                                                    return processed
                                        elif isinstance(sub_value, int):
                                            if sub_value > 0:
                                                doubled = sub_value * 2
                                                if doubled < 1000:
                                                    print(f"Doubled: {doubled}")
                                                    return doubled
                                                else:
                                                    print("Too large")
                                                    return None
                                            else:
                                                print("Negative value")
                                                return None
                                    else:
                                        continue
                            else:
                                continue
                        else:
                            continue
                    else:
                        continue
                else:
                    continue
            else:
                continue
        else:
            continue
    return None

data = [{"items": [{"target": "hello world"}, {"target": 42}]}]
process_data(data)`)
	})
})
