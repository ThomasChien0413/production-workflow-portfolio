// Decimal MB: leave 5 MB for multipart overhead below Cloudflare's 100 MB
// request ceiling. This governs new uploads, not legacy stored metadata.
export const SHEET_ATTACHMENT_MAX_UPLOAD_BYTES = 95_000_000;
