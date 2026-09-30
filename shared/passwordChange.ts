export function passwordChangeUrl(origin: string, fallbackUrl: string): string {
  try {
    const parsed = new URL(origin);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if (parsed.protocol !== 'https:' && !isLocal) return fallbackUrl;
    return new URL('/.well-known/change-password', parsed).toString();
  } catch {
    return fallbackUrl;
  }
}
