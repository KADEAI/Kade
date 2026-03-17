import { BaseTool, ToolCallbacks } from "./BaseTool"
import { Task } from "../task/Task"
import * as cheerio from 'cheerio'
import { ToolUse, WebSearchToolUse } from "../../shared/tools"
import { findLastIndex } from "../../shared/array"

/**
 * Perform web search using Startpage (more reliable than DuckDuckGo)
 * EXACT LOGIC FROM CLAUDIFY - DO NOT MODIFY
 */
async function performWebSearch(query: string, maxResults: number): Promise<any[]> {
    // Truncate query to avoid overly long URLs that might fail
    const truncatedQuery = query.length > 400 ? query.substring(0, 400) + '...' : query;
    const encodedQuery = encodeURIComponent(truncatedQuery);
    const startpageUrl = `https://www.startpage.com/do/search?query=${encodedQuery}`;
    console.log(`[web_search] Fetching: ${startpageUrl}`);

    const response = await fetch(startpageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Startpage results structure: each result is in a .result container
    const results: any[] = [];
    let debugLog: string[] = [];
    debugLog.push(`HTML Length: ${html.length}`);

    $('.result').each((i, resultEl) => {
        if (results.length >= maxResults) return false;

        const $result = $(resultEl);

        const titleLink = $result.find('a').first();
        let title = titleLink.text().trim();
        const href = titleLink.attr('href');
        let description = '';

        // Try different selectors for description
        const descSelectors = [
            '.result-description',
            '.w-gl__description',
            '.description',
            'p',
            '.result-snippet'
        ];

        for (const selector of descSelectors) {
            const descEl = $result.find(selector).first();
            if (descEl.length && descEl.text().trim()) {
                description = descEl.text().trim();
                break;
            }
        }

        // Fallback for description if empty
        if (!description) {
            description = $result.text().replace(title, '').trim().substring(0, 200) + '...';
        }

        // Try to get title from other common selectors if empty
        let altTitle = '';
        const titleSelectors = ['h3', '.result-title', '.w-gl__result-title', 'h2', '.title'];

        for (const selector of titleSelectors) {
            const titleEl = $result.find(selector).first();
            if (titleEl.length && titleEl.text().trim()) {
                altTitle = titleEl.text().trim();
                break;
            }
        }

        // IMPROVEMENT: If title is empty, try to get it from the h3 explicitly if not found by selectors
        if (!title && !altTitle) {
            const h3 = $result.find('h3').first();
            if (h3.length) title = h3.text().trim();
        }

        const finalTitle = (title && !title.includes('<img')) ? title : altTitle;
        const cleanTitle = finalTitle
            .replace(/<[^>]*>/g, '')  // Remove HTML tags
            .replace(/\.css-[^{]*\{[^}]*\}/g, '') // Remove CSS blocks
            .replace(/@media[^{]*\{[^}]*\}/g, '') // Remove @media CSS
            .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs from text
            .replace(/[›→]/g, '') // Remove breadcrumb separators
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        const cleanDescription = description
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/\.css-[^{]*\{[^}]*\}/g, '') // Remove CSS blocks
            .replace(/@media[^{]*\{[^}]*\}/g, '') // Remove @media CSS
            .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs from text
            .replace(/[›→]/g, '') // Remove breadcrumb separators
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        debugLog.push(`Candidate ${i}: Title="${cleanTitle}", URL="${href}"`);

        // Filter out internal links, duplicates, empty results, and CSS artifacts
        if (cleanTitle && href && href.startsWith('http') &&
            !href.includes('startpage.com') &&
            !results.some((r: any) => r.url === href) &&
            cleanTitle.length > 3 && // Filter out very short results
            !cleanTitle.startsWith('.') && // Filter out CSS class names
            !cleanTitle.includes('display:')) { // Filter out CSS properties

            results.push({
                title: cleanTitle,
                url: href,
                description: cleanDescription || undefined
            });
        } else {
            debugLog.push(`Skipped ${i}: Invalid filter criteria.`);
        }
        return true;
    });

    if (results.length === 0) {
        // Return debug info in description if no results found
        return [{ title: "Debug Info", url: "", description: "No results found. Debug Log:\n" + debugLog.join('\n') }];
    }

    return results;
}

export class WebSearchTool extends BaseTool<"web_search"> {
    readonly name = "web_search" as const;

    parseLegacy(params: Partial<Record<string, string>>): { query: string; max_results?: number } {
        return {
            query: params.query || "",
            max_results: params.max_results ? parseInt(params.max_results) : 10
        };
    }

    async execute(params: { query: string; max_results?: number }, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const { pushToolResult: originalPushToolResult } = callbacks;

        const pushToolResult = (content: any) => {
            originalPushToolResult(content);
            (async () => {
                try {
                    const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
                        try {
                            const parsed = JSON.parse(m.text || '{}');
                            const isToolMessage = (m.say === 'tool' || m.ask === 'tool') && parsed.tool === 'web_search';
                            return isToolMessage;
                        } catch (e) {
                            return false;
                        }
                    });

                    if (lastMsgIndex !== -1) {
                        const msg = task.clineMessages[lastMsgIndex];
                        const toolData = JSON.parse(msg.text || '{}');
                        toolData.content = content;
                        msg.text = JSON.stringify(toolData);
                        await task.updateClineMessage(msg);
                    }
                } catch (e) {
                    console.error(`[web_search] Failed to update UI: ${e}`);
                }
            })();
        };

        const maxResults = params.max_results || 10;
        const query = params.query;

        // Create tool message for approval
        const completeMessage = JSON.stringify({
            tool: "web_search",
            query: query,
            max_results: maxResults,
        });

        const didApprove = await callbacks.askApproval("tool", completeMessage, undefined, false);
        if (!didApprove) {
            return;
        }

        try {
            console.log('[web_search] Starting search for query:', query);
            const results = await performWebSearch(query, maxResults);
            console.log('[web_search] Search completed with results:', results.length);

            // SPECIAL HANDLE: Direct pass for Debug Info object (bypassing filters)
            if (results.length === 1 && results[0].title === "Debug Info") {
                pushToolResult([{
                    type: "text",
                    text: `results: No results found. ${results[0].description}`
                }]);
                return;
            }

            if (results.length === 0) {
                pushToolResult([{
                    type: "text",
                    text: "results: No results found for query."
                }]);
                return;
            }

            const formattedResults = results
                .map((result: any) => {
                    return `  - title: "${result.title}"\n    url: "${result.url}"\n    description: "${result.description || ''}"`;
                })
                .join("\n\n");

            pushToolResult([{
                type: "text",
                text: `results:\n${formattedResults}`
            }]);

        } catch (e: any) {
            console.error(`[web_search] Error: ${e}`);
            pushToolResult(`Search failed: ${e.message || e}`);
        }
    }
}

export const webSearchTool = new WebSearchTool();
