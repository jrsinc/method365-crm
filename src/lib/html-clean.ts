/** Removes anything in an email's HTML that could run code; the rest of its formatting stays. Safe on server and client. */
export function cleanHtml(html: string) {
  return html
    .replace(/<(script|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|iframe|object|embed|base|meta|link)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}
