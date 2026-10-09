import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Gmail through Google's REST APIs (no SDK). The OAuth client lives in Vercel env vars; each staff member's
// refresh token is stored encrypted in google_accounts with a key derived from the client secret.
const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  // Only to put JPR's candidate labels on threads; nothing is deleted or moved.
  "https://www.googleapis.com/auth/gmail.modify",
];

// The Command Center address registered as the redirect in Google Cloud (JPR Command Center web client).
export const GOOGLE_HOST = "jpr-site-tau.vercel.app";

export function googleReady() {
  return Boolean(clientId && clientSecret);
}

export function redirectUri(origin: string) {
  return `${origin}/api/google/callback`;
}

export function authUrl(origin: string, state: string, loginHint?: string) {
  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret!, ...params }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google: ${json.error_description ?? json.error ?? res.statusText}`);
  return json as { access_token: string; refresh_token?: string; id_token?: string; scope?: string };
}

export function exchangeCode(origin: string, code: string) {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
}

export async function accessToken(refreshToken: string) {
  return (await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" })).access_token;
}

// The id_token comes straight from Google's token endpoint over TLS, so its payload can be read as is.
export function idTokenEmail(idToken: string | undefined) {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

function key() {
  return createHash("sha256").update(`jpr-gmail-token:${clientSecret}`).digest();
}

export function sealToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function openToken(sealed: string) {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export type Attachment = { filename: string; mimeType: string; data: Buffer };
type Message = {
  from: string;
  to: string;
  cc?: string | null;
  replyTo?: string | null;
  subject: string;
  body: string;
  attachments?: Attachment[];
  threadId?: string;
};

const b64lines = (b: Buffer) => b.toString("base64").replace(/(.{76})/g, "$1\r\n");
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

// The plain-text body as simple HTML: same words and line breaks, with web addresses as short links.
function htmlBody(body: string) {
  const esc = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/\b(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, (m) => {
    const url = m.replace(/[.,)]+$/, "");
    const rest = m.slice(url.length);
    const href = url.startsWith("http") ? url : `https://${url}`;
    return `<a href="${href}">${url.replace(/^https?:\/\//, "")}</a>${rest}`;
  });
  return `<div style="font-family:Arial,sans-serif;font-size:14px">${linked.replace(/\r?\n/g, "<br>\n")}</div>`;
}

// RFC 2822 message, base64url-encoded the way the Gmail send endpoint wants it. Plain text, plus
// a multipart/mixed wrapper when there are attachments (a resume on a submission).
function mime({ from, to, cc, replyTo, subject, body, attachments = [] }: Message) {
  const reply = replyTo?.replace(/[\r\n]/g, "");
  const top = [`From: ${from}`, `To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), ...(reply ? [`Reply-To: ${reply}`] : []), `Subject: ${header(subject)}`, "MIME-Version: 1.0"];
  // Plain text plus an HTML copy, so a link (the website in the signature) shows as its short name. Outlook's
  // Safe Links rewrites every link a client receives, and in a plain-text email that long rewritten address
  // is what they see.
  const alt = `jpr-alt-${crypto.randomUUID()}`;
  const text = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(Buffer.from(body, "utf8")),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(Buffer.from(htmlBody(body), "utf8")),
    `--${alt}--`,
  ];
  let lines: string[];
  if (!attachments.length) {
    lines = [...top, ...text];
  } else {
    const boundary = `jpr-${crypto.randomUUID()}`;
    lines = [...top, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, ...text];
    for (const a of attachments) {
      const name = header(a.filename.replace(/["\r\n]/g, ""));
      lines.push(
        `--${boundary}`,
        `Content-Type: ${a.mimeType}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        b64lines(a.data),
      );
    }
    lines.push(`--${boundary}--`, "");
  }
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function sendGmail(token: string, message: Message) {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: mime(message), ...(message.threadId ? { threadId: message.threadId } : {}) }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail: ${json.error?.message ?? res.statusText}`);
  return json as { id: string; threadId: string };
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
export type GmailMessage = {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  date: Date;
  text: string;
  // Newsletters and other mass mail (an unsubscribe header, a bulk/list precedence or an auto-submitted flag).
  bulk: boolean;
};

async function gmailGet(token: string, path: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail: ${json.error?.message ?? res.statusText}`);
  return json;
}

async function gmailPost(token: string, path: string, body: unknown) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail: ${json.error?.message ?? res.statusText}`);
  return json;
}

// The id of a label by name, made (in the given colors) the first time it's needed.
export async function gmailLabel(token: string, name: string, color: { backgroundColor: string; textColor: string }) {
  const { labels = [] } = (await gmailGet(token, "labels")) as { labels?: { id: string; name: string }[] };
  const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const base = { name, labelListVisibility: "labelShow", messageListVisibility: "show" };
  try {
    return (await gmailPost(token, "labels", { ...base, color })).id as string;
  } catch {
    return (await gmailPost(token, "labels", base)).id as string;
  }
}

export async function labelThread(token: string, threadId: string, add: string[], remove: string[]) {
  await gmailPost(token, `threads/${threadId}/modify`, { addLabelIds: add, removeLabelIds: remove });
}

// Ids of messages matching a Gmail search, newest first.
export async function listGmail(token: string, q: string, max = 50): Promise<{ id: string; threadId: string }[]> {
  const json = await gmailGet(token, `messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
  return json.messages ?? [];
}

function plainText(part: Part): string {
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts ?? []) {
    const t = plainText(p);
    if (t) return t;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .replace(/<(br|\/p|\/div)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }
  return "";
}

// Just what they wrote: drops the quoted earlier message under "On ... wrote:" and ">" lines.
export function replyOnly(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex(
    (l, i) =>
      /^On .+wrote:\s*$/.test(l) ||
      (/^On .+/.test(l) && /wrote:\s*$/.test(lines[i + 1] ?? "")) ||
      /^-{2,}\s*Original Message/i.test(l) ||
      /^From: .+/.test(l),
  );
  return (cut >= 0 ? lines.slice(0, cut) : lines)
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function readGmail(token: string, id: string): Promise<GmailMessage> {
  const m = await gmailGet(token, `messages/${id}?format=full`);
  const headers: { name: string; value: string }[] = m.payload?.headers ?? [];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  const fromRaw = h("from");
  const email = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).trim().toLowerCase();
  const fromName =
    fromRaw
      .replace(/<[^>]+>/, "")
      .replace(/"/g, "")
      .trim() || email;
  const to =
    [h("to"), h("cc")]
      .join(",")
      .match(/[^\s<>,;"]+@[^\s<>,;"]+/g)
      ?.map((x) => x.toLowerCase()) ?? [];
  return {
    id: m.id,
    threadId: m.threadId,
    from: email,
    fromName,
    to,
    subject: h("subject"),
    date: new Date(Number(m.internalDate) || Date.now()),
    text: plainText(m.payload ?? {}) || m.snippet || "",
    bulk: Boolean(h("list-unsubscribe") || /bulk|list|junk/i.test(h("precedence")) || /auto-/i.test(h("auto-submitted"))),
  };
}

// The PDFs attached to one message (an offer letter), ready to attach to another email.
export async function gmailPdfs(token: string, id: string): Promise<Attachment[]> {
  type Att = Part & { filename?: string; body?: { data?: string; attachmentId?: string } };
  const m = await gmailGet(token, `messages/${id}?format=full`);
  const found: Att[] = [];
  const walk = (p: Att) => {
    if (p.filename && p.body?.attachmentId && (/pdf/i.test(p.mimeType ?? "") || /\.pdf$/i.test(p.filename))) found.push(p);
    for (const c of (p.parts ?? []) as Att[]) walk(c);
  };
  walk(m.payload ?? {});
  const out: Attachment[] = [];
  for (const p of found.slice(0, 3)) {
    const a = await gmailGet(token, `messages/${id}/attachments/${p.body!.attachmentId}`);
    if (a.data) out.push({ filename: p.filename!, mimeType: "application/pdf", data: Buffer.from(a.data, "base64url") });
  }
  return out;
}
