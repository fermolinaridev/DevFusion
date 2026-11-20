// Sanitização de texto para logs (portada da POC da Fase 0).
const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
  [/\b(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,})\b/g, '<api-key>'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '<jwt>'],
  [/\b(Bearer|token|access_token|refresh_token|id_token|password|senha)(["'\s:=]+)[^\s"',;]{6,}/gi, '$1$2<redigido>'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'],
];

export function redact(text: unknown, homeDir?: string): string {
  let s = typeof text === 'string' ? text : text instanceof Error ? `${text.name}: ${text.message}` : safeStringify(text);
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  if (homeDir) s = s.split(homeDir).join('~');
  return s;
}

function safeStringify(v: unknown): string {
  try { return typeof v === 'object' ? JSON.stringify(v) : String(v); } catch { return '[unserializable]'; }
}
