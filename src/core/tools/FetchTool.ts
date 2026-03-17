import { BaseTool, ToolCallbacks } from "./BaseTool"
import { Task } from "../task/Task"
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { ToolUse, WebFetchToolUse } from "../../shared/tools"
import { findLastIndex } from "../../shared/array"

/**
 * EXACT LOGIC FROM CLAUDIFY fetchTool.ts - DO NOT MODIFY
 */
export class WebFetchTool extends BaseTool<"web_fetch"> {
    readonly name = "web_fetch" as const;

    parseLegacy(params: Partial<Record<string, string>>): { url: string; include_links?: boolean } {
        const includeLinks = params.include_links?.trim().toLowerCase()
        return {
            url: params.url || "",
            include_links: includeLinks ? ["true", "1", "yes", "on"].includes(includeLinks) : undefined,
        }
    }

    async execute(params: { url: string; include_links?: boolean }, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const { pushToolResult: originalPushToolResult } = callbacks;

        const pushToolResult = (content: any) => {
            originalPushToolResult(content);
            (async () => {
                try {
                    const lastMsgIndex = findLastIndex(task.clineMessages, (m: any) => {
                        try {
                            const parsed = JSON.parse(m.text || '{}');
                            const isToolMessage = (m.say === 'tool' || m.ask === 'tool') && parsed.tool === 'web_fetch';
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
                    console.error(`[web_fetch] Failed to update UI: ${e}`);
                }
            })();
        };

        const input = params;

        // Create tool message for approval
        const completeMessage = JSON.stringify({
            tool: "web_fetch",
            url: input.url,
            ...(input.include_links ? { include_links: true } : {}),
        });

        const didApprove = await callbacks.askApproval("tool", completeMessage, undefined, false);
        if (!didApprove) {
            return;
        }

        try {
            console.log(`[fetch] Attempting to fetch URL: ${input.url}`);

            // 1. Try Jina Reader first (Best for clean content & bypassing bot blocks)
            const jinaUrl = `https://r.jina.ai/${input.url}`;
            try {
                const response = await fetch(jinaUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/plain, text/markdown, */*',
                        'X-No-Cache': 'true',
                        'X-Return-Format': 'markdown'
                    },
                    signal: AbortSignal.timeout(15000) // 15s timeout for Jina
                });

                if (response.ok) {
                    const text = await response.text();
                    // Validate that we got actual content and not a "Pardon our interruption" or empty page
                    if (text && text.trim().length > 300 && !text.includes("Pardon our interruption")) {
                        console.log(`[fetch] Jina success for ${input.url} (${text.length} chars)`);
                        
                        // Clean up Jina output (it can still have noisy image URLs and redundant links)
                        const cleanedText = this.cleanMarkdown(text, input.include_links).substring(0, 32000);

                        pushToolResult([{ type: "text", text: cleanedText }]);
                        return;
                    }
                }
            } catch (jinaError) {
                console.log(`[fetch] Jina failed for ${input.url}: ${jinaError}`);
            }

            // 2. Fallback: Try multiple bypass methods
            console.log(`[fetch] Falling back to bypass methods for: ${input.url}`);

            const bypassMethods = [
                {
                    name: 'Textise dot iitty',
                    url: `https://r.jina.ai/http://${input.url.replace(/^https?:\/\//, '')}`,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/plain, text/markdown, */*'
                    }
                },
                {
                    name: 'Textise dot iitty (https)',
                    url: `https://r.jina.ai/${input.url}`,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/plain, text/markdown, */*'
                    }
                },
                {
                    name: 'Direct with premium headers',
                    url: input.url,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5,en-GB;q=0.3',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Referer': 'https://www.google.com/',
                        'Origin': input.url.split('/')[2] ? `https://${input.url.split('/')[2]}` : '',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Cache-Control': 'max-age=0',
                        'DNT': '1',
                        'Connection': 'keep-alive'
                    }
                }
            ];

            for (const method of bypassMethods) {
                try {
                    console.log(`[fetch] Trying method: ${method.name}`);

                    const response = await fetch(method.url, {
                        headers: method.headers as HeadersInit,
                        signal: AbortSignal.timeout(12000) // 12s timeout
                    });

                    if (response.ok) {
                        const text = await response.text();

                        if (text && text.trim().length > 200 &&
                            !text.includes("403 Forbidden") &&
                            !text.includes("Access Denied") &&
                            !text.includes("Pardon our interruption") &&
                            !text.includes("blocked")) {

                            console.log(`[fetch] ${method.name} success for ${input.url} (${text.length} chars)`);

                            if (method.name.includes('Direct')) {
                                const $ = cheerio.load(text);
                                $('script, style, nav, footer, header, aside, noscript, iframe, svg, canvas, video, audio').remove();
                                $('.ads, .advertisement, .social-share, .metadata, .sidebar, .related-posts, .comments, .cookie-banner').remove();

                                let contentToConvert = '';
                                const mainSelectors = ['article', 'main', '[role="main"]', '.post-content', '.article-content', '#content', '.entry-content'];

                                for (const selector of mainSelectors) {
                                    const el = $(selector);
                                    if (el.length && el.text().trim().length > 500) {
                                        contentToConvert = el.html() || '';
                                        break;
                                    }
                                }

                                if (!contentToConvert) {
                                    contentToConvert = $('body').html() || '';
                                }

                                const turndown = new TurndownService({
                                    headingStyle: 'atx',
                                    codeBlockStyle: 'fenced',
                                    emDelimiter: '_',
                                    strongDelimiter: '**'
                                });

                                turndown.addRule('remove_links', {
                                    filter: ['a'],
                                    replacement: (content, node) => {
                                        const href = (node as any).getAttribute('href');
                                        if (href && content.length > 3 && !content.toLowerCase().includes('click here')) {
                                            return `[${content}](${href})`;
                                        }
                                        return content;
                                    }
                                });

                                let markdown = turndown.turndown(contentToConvert);
                                markdown = this.cleanMarkdown(markdown, input.include_links);

                                if (!markdown || markdown.length < 100) {
                                    markdown = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 10000);
                                }

                                pushToolResult([{ type: "text", text: markdown.substring(0, 25000) }]);
                                return;
                            } else {
                                const cleanedText = this.cleanMarkdown(text, input.include_links).substring(0, 32000);
                                pushToolResult([{ type: "text", text: cleanedText }]);
                                return;
                            }
                        }
                    }
                } catch (methodError) {
                    console.warn(`[fetch] ${method.name} failed for ${input.url}: ${methodError}`);
                }
            }

            throw new Error(`All fetch methods failed for ${input.url}`);

        } catch (error: any) {
            await callbacks.handleError("fetching URL", error);
        }
    }

    /**
     * Cleans and compresses markdown content for AI consumption.
     * Removes images, empty links, tracking parameters, and redundant identical links.
     */
    private cleanMarkdown(text: string, includeLinks = false): string {
        let cleaned = text
            // Remove empty links like [ ](url)
            .replace(/\[\s*\]\(.*?\)/g, '')
            // Remove autolinks like <https://...> in compact mode
            .replace(/<https?:\/\/[^>\s]+>/g, (match) => (includeLinks ? match : ""))
            // Shorten URLs by removing common tracking/junk query params
            .replace(/\[(.*?)\]\((https?:\/\/.*?)\)/g, (match, linkText, url) => {
                try {
                    const u = new URL(url);
                    const junkParams = [
                        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
                        'ref', 'source', 'ref_cta', 'ref_loc', 'ref_page', 'source_repo', 'fbclid'
                    ];
                    let changed = false;
                    junkParams.forEach(p => {
                        if (u.searchParams.has(p)) {
                            u.searchParams.delete(p);
                            changed = true;
                        }
                    });
                    if (!includeLinks) {
                        return linkText.trim()
                    }
                    return changed ? `[${linkText}](${u.toString()})` : match;
                } catch (e) {
                    return includeLinks ? match : linkText;
                }
            })

        cleaned = includeLinks
            ? cleaned.replace(/!\[.*?\]\(.*?\)/g, "[Image]")
            : cleaned
                // Drop images entirely in the default compact mode.
                .replace(/!\[.*?\]\(.*?\)/g, "")
                // Drop leftover upstream image placeholders/links.
                .replace(/\[\[Image\]\]\(.*?\)/g, "")
                .replace(/^\s*\[Image\]\s*$/gm, "")

        return cleaned
            // Remove redundant consecutive links to the same destination
            .replace(/(\[.*?\]\((.*?)\))\s*\|\s*\[.*?\]\(\2\)/g, '$1 |')
            .replace(/(\[.*?\]\((.*?)\))\s+\[.*?\]\(\2\)/g, '$1')
            // Collapse excessive whitespace
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim()
    }
}

export const webFetchTool = new WebFetchTool();
