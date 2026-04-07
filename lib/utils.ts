/**
 * Clean up a raw listing description for display.
 * Strips HTML entities, unicode junk, excessive whitespace, and truncation artifacts.
 */
export function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;

  let text = raw
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    // Strip common unicode junk (replacement char, zero-width, object replacement, etc.)
    .replace(/[\uFFFD\uFFFC\u200B\u200C\u200D\uFEFF\u00A0]/g, ' ')
    // Strip emoji-like object replacement characters that show as boxes
    .replace(/\uFFFC/g, '')
    // Normalize various dash/quote characters to ASCII
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '—')
    .replace(/\u2026/g, '...')
    // Strip any remaining control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    // Collapse whitespace runs (but keep single newlines)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // Trim trailing truncation artifacts like "..." at the very end
    .replace(/\.{2,}\s*$/, '')
    .trim();

  // Skip if too short after cleaning
  if (text.length < 10) return null;

  return text;
}
