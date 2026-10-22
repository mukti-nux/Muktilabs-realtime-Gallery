export function safeFilename(raw: string) {
  // Avoid CRLF injection, path traversal and non-ascii Content-Disposition ambiguity.
  const name = raw.split(/[\\/]/).pop() || 'photo.jpg';
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 150) || 'photo.jpg';
}
export function asError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
