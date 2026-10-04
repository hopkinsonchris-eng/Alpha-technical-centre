/**
 * Sending through Zoho Mail (wave 6, D63, P60): a letter leaves from the person's own address with the rendered
 * attachment, using the refresh token they granted at sign-in (scope ZohoMail.messages.CREATE). Attachments are
 * uploaded first (POST …/messages/attachments), then the message is posted with their references. The sent copy
 * is captured back by the next poll and files to the draft's project. All HTTP goes through the injected fetch.
 */
export interface SendConnection { address: string; accountId: string; apiUrl: string; accountsUrl: string; clientId: string; clientSecret: string; refreshToken: string }
export interface SendRequest { to: string[]; cc?: string[]; subject: string; text: string; html?: string; attachments?: Array<{ filename: string; mime: string; bytes: Uint8Array }> }
export interface SendResult { message_id: string; from: string; to: string[]; attachments: string[] }
export class ZohoSendError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function accessToken(c: SendConnection, f: typeof fetch): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
  const res = await f(`${c.accountsUrl.replace(/\/+$/, '')}/oauth/v2/token`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new ZohoSendError(502, `zoho token refresh failed (${res.status}): ${j.error ?? 'no access_token'}`);
  return j.access_token;
}

export async function sendMail(c: SendConnection, req: SendRequest, f: typeof fetch = fetch): Promise<SendResult> {
  const token = await accessToken(c, f);
  const base = `${c.apiUrl.replace(/\/+$/, '')}/api/accounts/${encodeURIComponent(c.accountId)}`;
  const auth = { authorization: `Zoho-oauthtoken ${token}` };
  const uploaded: Array<{ storeName: string; attachmentName: string; attachmentPath: string }> = [];
  for (const a of req.attachments ?? []) {
    const res = await f(`${base}/messages/attachments?fileName=${encodeURIComponent(a.filename)}`, { method: 'POST', headers: { ...auth, 'content-type': a.mime || 'application/octet-stream' }, body: a.bytes as unknown as BodyInit });
    const j: any = await res.json().catch(() => ({}));
    const d = Array.isArray(j.data) ? j.data[0] : j.data;
    if (!res.ok || !d?.storeName) throw new ZohoSendError(502, `zoho attachment upload failed (${res.status}) for ${a.filename}`);
    uploaded.push({ storeName: d.storeName, attachmentName: d.attachmentName ?? a.filename, attachmentPath: d.attachmentPath ?? '' });
  }
  const body: Record<string, unknown> = {
    fromAddress: c.address, toAddress: req.to.join(','), ...(req.cc?.length ? { ccAddress: req.cc.join(',') } : {}), subject: req.subject,
    content: req.html ?? req.text, mailFormat: req.html ? 'html' : 'plaintext', askReceipt: 'no', ...(uploaded.length ? { attachments: uploaded } : {}),
  };
  const res = await f(`${base}/messages`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ZohoSendError(res.status === 429 ? 429 : 502, `zoho send failed (${res.status}): ${j?.data?.errorCode ?? j?.status?.description ?? ''}`.trim());
  const id = j?.data?.messageId ?? j?.data?.[0]?.messageId ?? null;
  return { message_id: id ? String(id) : '', from: c.address, to: req.to, attachments: uploaded.map(u => u.attachmentName) };
}
