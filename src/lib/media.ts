export const PROJECT_IMAGE_MAX_LENGTH = 175000;
export const COVER_WEBP_MAX_LENGTH = 160000;
export const AVATAR_WEBP_MAX_LENGTH = 48000;

export async function convertImageToWebpDataUrl(
  file: File,
  options: { maxSide: number; maxLength: number },
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("INVALID_IMAGE"));
      element.src = objectUrl;
    });

    let currentMaxSide = options.maxSide;
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, currentMaxSide / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const supportsWebp = canvas
        .toDataURL("image/webp", 0.8)
        .startsWith("data:image/webp;base64,");
      const mimeType = supportsWebp ? "image/webp" : "image/jpeg";
      const expectedPrefix = `data:${mimeType};base64,`;

      for (const quality of [0.82, 0.7, 0.58, 0.45, 0.34, 0.24]) {
        const dataUrl = canvas.toDataURL(mimeType, quality);
        if (dataUrl.startsWith(expectedPrefix) && dataUrl.length <= options.maxLength) {
          return dataUrl;
        }
      }

      currentMaxSide = Math.max(160, Math.round(currentMaxSide * 0.7));
    }

    throw new Error("IMAGE_TOO_LARGE");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function sanitizeExternalHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[\s<>"]/.test(trimmed)) return null;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!parsed.hostname || !parsed.hostname.includes(".") || parsed.username || parsed.password) {
      return null;
    }
    const normalized = parsed.toString();
    if (normalized.length > 300 || /[\s<>"]/.test(normalized)) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function parseGoogleDriveVideoUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[\s<>"]/.test(trimmed)) return null;

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== "drive.google.com" && host !== "docs.google.com") {
      return null;
    }

    const pathMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,120})(?:\/|$)/);
    const paramId = parsed.searchParams.get("id");
    const fileId =
      pathMatch?.[1] ??
      (paramId && /^[a-zA-Z0-9_-]{10,120}$/.test(paramId) ? paramId : null);

    if (!fileId) return null;
    return `https://drive.google.com/file/d/${fileId}/preview`;
  } catch {
    return null;
  }
}

export type BioSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

export function extractTextSegmentsWithLinks(text: string): BioSegment[] {
  const segments: BioSegment[] = [];
  const urlPattern = /https?:\/\/[^\s<>"]+/g;
  let lastIndex = 0;

  for (const match of text.matchAll(urlPattern)) {
    const start = match.index ?? 0;
    let rawUrl = match[0];
    let trailing = "";

    while (rawUrl.length > 0 && /[.,،؛!?)}\]]$/.test(rawUrl)) {
      trailing = rawUrl.slice(-1) + trailing;
      rawUrl = rawUrl.slice(0, -1);
    }

    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }

    const safeHref = sanitizeExternalHttpUrl(rawUrl);
    if (safeHref) {
      segments.push({ type: "link", value: rawUrl, href: safeHref });
    } else {
      segments.push({ type: "text", value: rawUrl });
    }

    if (trailing) {
      segments.push({ type: "text", value: trailing });
    }

    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}
