export interface UrlPreviewInfo {
  domain: string;
  serviceName: string;
  title?: string;
  brandColor: string;
}

const BRANDS: Record<string, [string, string]> = {
  "github.com": ["GitHub", "#6e7681"],
  "youtube.com": ["YouTube", "#ff0033"],
  "youtu.be": ["YouTube", "#ff0033"],
  "reddit.com": ["Reddit", "#ff4500"],
  "linkedin.com": ["LinkedIn", "#0a66c2"],
  "wikipedia.org": ["Wikipedia", "#8b8b8b"],
  "figma.com": ["Figma", "#f24e1e"],
  "spotify.com": ["Spotify", "#1ed760"],
  "notion.so": ["Notion", "#8d8d8d"],
  "discord.com": ["Discord", "#5865f2"],
  "openai.com": ["OpenAI", "#10a37f"],
  "chatgpt.com": ["ChatGPT", "#10a37f"],
  "docs.google.com": ["Google Docs", "#4285f4"],
  "drive.google.com": ["Google Drive", "#0f9d58"],
};

export function parseUrlPreview(rawUrl: string): UrlPreviewInfo {
  try {
    const parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const match = Object.entries(BRANDS).find(([key]) => domain === key || domain.endsWith(`.${key}`));
    const domainParts = domain.split(".");
    const fallback = domainParts[domainParts.length - 2] || domain;
    const serviceName = match?.[1][0] || fallback.charAt(0).toUpperCase() + fallback.slice(1);
    const brandColor = match?.[1][1] || "#64748b";
    const parts = parsed.pathname.split("/").filter(Boolean);
    let title: string | undefined;
    if (domain.endsWith("github.com") && parts.length >= 2) {
      title = `${parts[0]}/${parts[1]}`;
      if ((parts[2] === "issues" || parts[2] === "pull") && parts[3]) {
        title += ` · ${parts[2] === "pull" ? "PR" : "Issue"} #${parts[3]}`;
      }
    } else if (domain.endsWith("wikipedia.org") && parts[0] === "wiki" && parts[1]) {
      title = decodeURIComponent(parts[1]).replace(/_/g, " ");
    } else if (domain.endsWith("reddit.com") && parts[0] === "r" && parts[1]) {
      title = `r/${parts[1]}`;
    } else if (parts.length > 0) {
      const candidate = decodeURIComponent(parts[parts.length - 1] || "")
        .replace(/[-_]/g, " ")
        .replace(/\.(html?|php|aspx?)$/i, "");
      if (candidate.length > 3 && !/^[0-9a-f]{8,}$/i.test(candidate)) title = candidate;
    }
    return { domain, serviceName, title, brandColor };
  } catch {
    return { domain: rawUrl, serviceName: "Web Link", brandColor: "#64748b" };
  }
}
