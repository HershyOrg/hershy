import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const previewCache = new Map<string, ScrapePreviewResult>();

type ScrapePreviewResult = {
  url: string;
  title?: string;
  imageUrl?: string;
  extractedFrom?: string;
  error?: string;
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/");
}

function normalizeUrl(value: string, baseUrl: string) {
  const trimmedValue = decodeHtml(value.trim());
  if (!trimmedValue || trimmedValue.startsWith("data:")) return undefined;

  try {
    return new URL(trimmedValue, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function getComparableImageUrl(value: string) {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function getImageScore(value: string) {
  const lowerUrl = getComparableImageUrl(value);

  if (
    lowerUrl.includes("schema.org") ||
    lowerUrl.includes("sprite") ||
    lowerUrl.includes("logo") ||
    lowerUrl.includes("favicon") ||
    lowerUrl.includes("apple-icon") ||
    lowerUrl.includes("splash") ||
    lowerUrl.includes("og_v3") ||
    lowerUrl.includes("icon_") ||
    lowerUrl.includes("/icons/") ||
    lowerUrl.includes("profileimage") ||
    lowerUrl.includes("keyword_emoji") ||
    lowerUrl.endsWith(".svg") ||
    lowerUrl.endsWith(".gif")
  ) {
    return 0;
  }

  let score = 10;
  if (lowerUrl.includes("m.media-amazon.com/images/i/")) score += 120;
  if (lowerUrl.includes("media-amazon") && lowerUrl.includes("._ac_")) score += 30;
  if (lowerUrl.includes("search.pstatic.net/sunny")) score += 100;
  if (lowerUrl.includes("gocamping.or.kr")) score += 40;
  if (lowerUrl.includes("img-cf.kurly.com") || lowerUrl.includes("product-image.kurly.com")) score += 100;
  if (lowerUrl.includes("/goods/") || lowerUrl.includes("/product/")) score += 20;
  if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(lowerUrl)) score += 12;

  return score;
}

function pickBestImage(values: Array<string | undefined>, baseUrl: string) {
  const candidates = values
    .map((value) => (value ? normalizeUrl(value, baseUrl) : undefined))
    .filter((value): value is string => Boolean(value));
  const uniqueCandidates = Array.from(new Set(candidates));
  const rankedCandidates = uniqueCandidates
    .map((url) => ({
      url,
      score: getImageScore(url),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return rankedCandidates[0]?.url;
}

function extractMetaContent(html: string, names: string[]) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const name of names) {
    for (const tag of metaTags) {
      const propertyMatch = tag.match(/\b(?:property|name|itemprop)=["']([^"']+)["']/i);
      if (propertyMatch?.[1]?.toLowerCase() !== name.toLowerCase()) continue;

      const contentMatch = tag.match(/\bcontent=["']([^"']+)["']/i);
      if (contentMatch?.[1]) return decodeHtml(contentMatch[1]);
    }
  }

  return undefined;
}

function extractMetaImageCandidates(html: string) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const names = ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src", "image"];
  const candidates: string[] = [];

  for (const tag of metaTags) {
    const propertyMatch = tag.match(/\b(?:property|name|itemprop)=["']([^"']+)["']/i);
    if (!propertyMatch?.[1] || !names.includes(propertyMatch[1].toLowerCase())) continue;

    const contentMatch = tag.match(/\bcontent=["']([^"']+)["']/i);
    if (contentMatch?.[1]) candidates.push(contentMatch[1]);
  }

  return candidates;
}

function extractTagText(html: string, tagName: string) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match?.[1]) return undefined;

  return decodeHtml(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractJsonLdImage(html: string, baseUrl: string) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];

  for (const script of scripts) {
    const rawJson = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    if (!rawJson) continue;

    try {
      const parsed = JSON.parse(decodeHtml(rawJson)) as unknown;
      const image = findImageInJson(parsed);
      if (image) return normalizeUrl(image, baseUrl);
    } catch {
      continue;
    }
  }

  return undefined;
}

function findImageInJson(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = findImageInJson(item);
      if (image) return image;
    }

    return undefined;
  }
  if (typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const imageValue = record.image ?? record.thumbnailUrl;
  const directImage = findDirectImageValue(imageValue);
  if (directImage) return directImage;

  for (const nestedValue of Object.values(record)) {
    const image = findImageInJson(nestedValue);
    if (image) return image;
  }

  return undefined;
}

function findDirectImageValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = findDirectImageValue(item);
      if (image) return image;
    }

    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const url = record.url ?? record.contentUrl;
  return typeof url === "string" ? url : undefined;
}

function extractAmazonImageCandidates(html: string) {
  const candidates: string[] = [];
  const dynamicImageMatch = html.match(/data-a-dynamic-image=["']([^"']+)["']/i);
  if (dynamicImageMatch?.[1]) {
    try {
      const images = JSON.parse(decodeHtml(dynamicImageMatch[1])) as Record<string, unknown>;
      candidates.push(...Object.keys(images));
    } catch {
      // Continue to generic image extraction.
    }
  }

  const amazonImageMatches = html.match(/https?:\/\/[^"'\s<>]+(?:media-amazon|ssl-images-amazon)[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/gi) ?? [];
  candidates.push(...amazonImageMatches);

  return candidates;
}

function extractImageCandidates(html: string) {
  const candidates: string[] = [];
  const imageTags = html.match(/<img\b[^>]*>/gi) ?? [];

  for (const tag of imageTags) {
    const sourceMatch = tag.match(/\b(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/i);
    if (sourceMatch?.[1]) candidates.push(sourceMatch[1]);
  }

  candidates.push(...(html.match(/https?:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>]*)?/gi) ?? []));

  return candidates;
}

function extractPreview(html: string, url: string): ScrapePreviewResult {
  const title =
    extractMetaContent(html, ["og:title", "twitter:title", "title"]) ??
    extractTagText(html, "title") ??
    extractTagText(html, "h1");
  const imageUrl = pickBestImage(
    [
      ...extractAmazonImageCandidates(html),
      extractJsonLdImage(html, url),
      ...extractImageCandidates(html),
      ...extractMetaImageCandidates(html),
    ],
    url,
  );

  return {
    url,
    title,
    imageUrl,
    extractedFrom: imageUrl ? new URL(url).hostname : undefined,
    error: imageUrl ? undefined : "No image metadata found",
  };
}

async function fetchPreview(url: string): Promise<ScrapePreviewResult> {
  if (previewCache.has(url)) return previewCache.get(url)!;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        url,
        error: `Request failed with ${response.status}`,
      };
    }

    const html = await response.text();
    const preview = extractPreview(html, response.url || url);
    previewCache.set(url, preview);

    return preview;
  } catch (error) {
    return {
      url,
      error: error instanceof Error ? error.message : "Unknown scrape error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function writeJson(response: ServerResponse, statusCode: number, payload: ScrapePreviewResult) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function getRequestUrl(request: IncomingMessage) {
  return new URL(request.url ?? "", "http://localhost");
}

function scrapePreviewPlugin(): Plugin {
  return {
    name: "thirdeye-scrape-preview",
    configureServer(server) {
      server.middlewares.use("/api/scrape-preview", async (request, response) => {
        const requestUrl = getRequestUrl(request);
        const targetUrl = requestUrl.searchParams.get("url");

        if (!targetUrl) {
          writeJson(response, 400, { url: "", error: "Missing url parameter" });
          return;
        }

        let parsedTargetUrl: URL;
        try {
          parsedTargetUrl = new URL(targetUrl);
        } catch {
          writeJson(response, 400, { url: targetUrl, error: "Invalid url parameter" });
          return;
        }

        if (!["http:", "https:"].includes(parsedTargetUrl.protocol)) {
          writeJson(response, 400, { url: targetUrl, error: "Only http and https URLs are supported" });
          return;
        }

        const preview = await fetchPreview(parsedTargetUrl.toString());
        writeJson(response, preview.imageUrl ? 200 : 502, preview);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), scrapePreviewPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
