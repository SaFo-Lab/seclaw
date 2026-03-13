/**
 * Web tools
 */

import axios from "axios";
import { Tool } from "./base";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36";

function stripTags(text: string): string {
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function normalize(text: string): string {
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function validateUrl(url: string): [boolean, string] {
  try {
    const p = new URL(url);
    if (!["http:", "https:"].includes(p.protocol)) {
      return [false, `Only http/https allowed, got '${p.protocol}'`];
    }
    if (!p.hostname) return [false, "Missing domain"];
    return [true, ""];
  } catch (e) {
    return [false, String(e)];
  }
}

export class WebSearchTool extends Tool {
  private apiKey: string;
  private maxResults: number;

  constructor(opts: { apiKey?: string | null; maxResults?: number } = {}) {
    super();
    this.apiKey = opts.apiKey ?? process.env.BRAVE_API_KEY ?? "";
    this.maxResults = opts.maxResults ?? 5;
  }

  get name(): string { return "web_search"; }
  get description(): string { return "Search the web. Returns titles, URLs, and snippets."; }
  get parameters() {
    return {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "Search query" },
        count: { type: "integer" as const, description: "Results (1-10)", minimum: 1, maximum: 10 },
      },
      required: ["query"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const query = params["query"] as string;
    const count = Math.min(Math.max((params["count"] as number | undefined) ?? this.maxResults, 1), 10);

    if (!this.apiKey) return "Error: BRAVE_API_KEY not configured";

    try {
      const resp = await axios.get("https://api.search.brave.com/res/v1/web/search", {
        params: { q: query, count },
        headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
        timeout: 10000,
      });

      const results = (resp.data?.web?.results ?? []) as Record<string, string>[];
      if (!results.length) return `No results for: ${query}`;

      const lines = [`Results for: ${query}\n`];
      for (let i = 0; i < Math.min(results.length, count); i++) {
        const item = results[i]!;
        lines.push(`${i + 1}. ${item["title"] ?? ""}\n   ${item["url"] ?? ""}`);
        if (item["description"]) lines.push(`   ${item["description"]}`);
      }
      return lines.join("\n");
    } catch (e) {
      return `Error: ${e}`;
    }
  }
}

export class WebFetchTool extends Tool {
  private maxChars: number;

  constructor(maxChars = 50000) {
    super();
    this.maxChars = maxChars;
  }

  get name(): string { return "web_fetch"; }
  get description(): string { return "Fetch URL and extract readable content (HTML → text)."; }
  get parameters() {
    return {
      type: "object" as const,
      properties: {
        url: { type: "string" as const, description: "URL to fetch" },
        extractMode: { type: "string" as const, enum: ["markdown", "text"], description: "Extraction mode" },
        maxChars: { type: "integer" as const, minimum: 100 },
      },
      required: ["url"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const url = params["url"] as string;
    const maxChars = (params["maxChars"] as number | undefined) ?? this.maxChars;

    const [valid, errMsg] = validateUrl(url);
    if (!valid) {
      return JSON.stringify({ error: `URL validation failed: ${errMsg}`, url });
    }

    try {
      const resp = await axios.get(url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 30000,
        maxRedirects: 5,
        responseType: "text",
        validateStatus: null,
      });

      const contentType = resp.headers["content-type"] ?? "";
      let text: string;
      let extractor: string;

      if (contentType.includes("application/json")) {
        text = JSON.stringify(resp.data, null, 2);
        extractor = "json";
      } else if (contentType.includes("text/html") || (resp.data as string).slice(0, 256).toLowerCase().startsWith("<!doctype")) {
        text = this._htmlToText(resp.data as string);
        extractor = "html-strip";
      } else {
        text = resp.data as string;
        extractor = "raw";
      }

      const truncated = text.length > maxChars;
      if (truncated) text = text.slice(0, maxChars);

      return JSON.stringify({
        url,
        finalUrl: resp.request?.res?.responseUrl ?? url,
        status: resp.status,
        extractor,
        truncated,
        length: text.length,
        text,
      });
    } catch (e) {
      return JSON.stringify({ error: String(e), url });
    }
  }

  private _htmlToText(html: string): string {
    // Simple HTML-to-text conversion
    let text = html;
    // Remove script and style
    text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
    // Replace block elements with newlines
    text = text.replace(/<\/?(p|div|section|article|h[1-6]|li|br|hr)[^>]*>/gi, "\n");
    // Strip remaining tags
    text = stripTags(text);
    return normalize(text);
  }
}
