/**
 * What somebody types into the link box, made into an address. People type `example.com` and their
 * email address, not `https://example.com` and `mailto:`; a bare domain kept as typed is a link to a
 * page of the blog itself. An address that already says where it goes is kept as it is.
 */
export function linkHref(raw: string): string {
  const url = raw.trim();
  if (!url || /^([a-z][a-z\d+.-]*:\/\/|mailto:|tel:|[/#?])/i.test(url))
    return url;
  if (/^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(url)) return `mailto:${url}`;
  return `https://${url}`;
}
