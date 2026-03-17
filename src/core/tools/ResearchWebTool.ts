import { BaseTool, ToolCallbacks } from "./BaseTool"
import { Task } from "../task/Task"
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { findLastIndex } from "../../shared/array"

// --- Helper: Web Search (StartPage) ---
async function performWebSearch(query: string, maxResults: number): Promise<any[]> {
    const encodedQuery = encodeURIComponent(query);
    const startpageUrl = `https://www.startpage.com/do/search?query=${encodedQuery}`;

    const response = await fetch(startpageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: any[] = [];

    $('.result').each((i, resultEl) => {
        if (results.length >= maxResults) return false;
        const $result = $(resultEl);
        const titleLink = $result.find('a').first();
        const title = titleLink.text().trim();
        const href = titleLink.attr('href');
        let description = $result.find('.result-snippet, .description, p').first().text().trim();

        if (!description) description = $result.text().replace(title, '').substring(0, 200) + '...';

        if (title && href && href.startsWith('http') && !href.includes('startpage.com')) {
            results.push({ title, url: href, description });
        }
        return;
    });

    return results;
}

// --- Helper: Web Fetch (Jina/Bypass) ---
async function performWebFetch(url: string): Promise<string | null> {
    // 1. Try Jina Reader
    try {
        const jinaUrl = `https://r.jina.ai/${url}`;
        const response = await fetch(jinaUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'X-Return-Format': 'markdown' },
            signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
            const text = await response.text();
            if (text.length > 300 && !text.includes("Pardon our interruption")) return text;
        }
    } catch (e) { /* ignore */ }

    // 2. Fallback: Direct Fetch + Cheerio/Turndown
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Upgrade-Insecure-Requests': '1'
            },
            signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
            const html = await response.text();
            const $ = cheerio.load(html);
            $('script, style, nav, footer, iframe, svg, canvas').remove();

            // Extract Main Content
            let content = $('article, main, .content').html() || $('body').html() || '';

            // Convert to Markdown
            const turndown = new TurndownService();
            let markdown = turndown.turndown(content);
            return markdown.replace(/\n\s*\n/g, '\n\n').trim();
        }
    } catch (e) { /* ignore */ }

    return null;
}


export class ResearchWebTool extends BaseTool<"research_web"> {
    readonly name = "research_web" as const;

    parseLegacy(params: Partial<Record<string, string>>): { query: string; depth?: number } {
        return {
            query: params.query || "",
            depth: params.depth ? parseInt(params.depth) : 3
        };
    }

    async execute(params: { query: string; depth?: number }, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const { pushToolResult: originalPushToolResult } = callbacks;
        const pushToolResult = (content: any) => {
            originalPushToolResult(content);
            (async () => {
                try {
                    const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
                        try {
                            const parsed = JSON.parse(m.text || '{}');
                            const isToolMessage = (m.say === 'tool' || m.ask === 'tool') && parsed.tool === 'research_web';
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
                    console.error(`[research_web] Failed to update UI: ${e}`);
                }
            })();
        };

        const depth = params.depth || 3;
        const query = params.query;

        // Ask for approval using the callback (supports auto-approval)
        const completeMessage = JSON.stringify({ tool: "research_web", query, depth });
        const didApprove = await callbacks.askApproval("tool", completeMessage, undefined, false);
        if (!didApprove) return;

        try {
            console.log(`[research] Starting deep research: "${query}" (depth: ${depth})`);

            // 1. Search
            const searchResults = await performWebSearch(query, depth + 2); // Get a few extra candidates
            const candidates = searchResults.slice(0, depth);

            if (candidates.length === 0) {
                pushToolResult([{ type: "text", text: "No search results found to research." }]);
                return;
            }

            // 2. Parallel Fetch
            console.log(`[research] Fetching ${candidates.length} URLs in parallel...`);
            const fetchPromises = candidates.map(async (res) => {
                try {
                    const content = await performWebFetch(res.url);
                    return { ...res, content, status: content ? 'success' : 'failed' };
                } catch (e) {
                    return { ...res, content: null, status: 'failed' };
                }
            });

            const fetchedResults = await Promise.all(fetchPromises);

            // 3. Synthesize Report
            let report = `# Deep Research Report: ${query}\n\n`;
            report += `Analyzed ${candidates.length} sources.\n\n`;

            fetchedResults.forEach((res, i) => {
                if (res.status === 'success') {
                    report += `## [Source ${i + 1}: ${res.title}](${res.url})\n`;
                    report += `> ${res.description}\n\n`;
                    // Truncate content to avoid token explosion (e.g. 2000 chars per source)
                    report += `${res.content?.substring(0, 2000)}...\n\n---\n\n`;
                } else {
                    report += `## Source ${i + 1}: ${res.title} (Fetch Failed)\n[${res.url}](${res.url})\n\n`;
                }
            });

            pushToolResult([{ type: "text", text: report }]);

        } catch (e: any) {
            console.error(`[research] Failed: ${e}`);
            pushToolResult(`Research failed: ${e.message}`);
        }
    }
}

export const researchWebTool = new ResearchWebTool();
