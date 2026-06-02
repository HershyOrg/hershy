/**
 * post_approved.js
 * Reads /files/queue.csv and /files/accounts.csv.
 * Finds rows with status=approved, posts generated_text to the matching X account,
 * then updates the row to status=posted.
 *
 * For security, store X tokens as environment variables and reference them in accounts.csv:
 * account_name,x_token_env,x_access_token,enabled
 * account_01,X_TOKEN_ACCOUNT_01,,true
 *
 * Run inside n8n Execute Command:
 *   node /files/scripts/post_approved.js
 */

const fs = require("fs");

const QUEUE_PATH = process.env.QUEUE_PATH || "/files/queue.csv";
const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || "/files/accounts.csv";
const POST_BATCH_LIMIT = Number(process.env.POST_BATCH_LIMIT || 10);
const POST_DELAY_MS = Number(process.env.POST_DELAY_MS || 30000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // ignore CR
      } else {
        field += c;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return { headers: [], data: [] };

  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1)
    .filter(r => r.some(v => String(v || "").trim() !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => obj[h] = r[idx] ?? "");
      return obj;
    });

  return { headers, data };
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(headers, data) {
  const lines = [];
  lines.push(headers.map(escapeCsv).join(","));
  for (const row of data) {
    lines.push(headers.map(h => escapeCsv(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function nowIso() {
  return new Date().toISOString();
}

function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    throw new Error(`Missing accounts file: ${ACCOUNTS_PATH}`);
  }
  const { data } = parseCsv(fs.readFileSync(ACCOUNTS_PATH, "utf8"));
  const map = new Map();
  for (const acc of data) {
    const name = String(acc.account_name || "").trim();
    if (!name) continue;
    map.set(name, acc);
  }
  return map;
}

function getTokenForAccount(account) {
  const enabled = String(account.enabled || "true").trim().toLowerCase();
  if (!["true", "1", "yes", "y"].includes(enabled)) {
    throw new Error(`Account disabled: ${account.account_name}`);
  }

  const envName = String(account.x_token_env || "").trim();
  const tokenFromEnv = envName ? process.env[envName] : "";
  const tokenFromCsv = String(account.x_access_token || "").trim();

  const token = tokenFromEnv || tokenFromCsv;
  if (!token) {
    throw new Error(`Missing X token for ${account.account_name}. Set env ${envName} or x_access_token in accounts.csv.`);
  }

  return token;
}

async function postToX(token, text) {
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  const bodyText = await res.text();
  let bodyJson = {};
  try { bodyJson = JSON.parse(bodyText); } catch {}

  if (!res.ok) {
    throw new Error(`X API HTTP ${res.status}: ${bodyText.slice(0, 1000)}`);
  }

  const tweetId = bodyJson.data && bodyJson.data.id ? bodyJson.data.id : "";
  return {
    tweet_id: tweetId,
    posted_url: tweetId ? `https://x.com/i/web/status/${tweetId}` : "",
    raw: bodyJson
  };
}

(async () => {
  if (!fs.existsSync(QUEUE_PATH)) {
    throw new Error(`Missing queue file: ${QUEUE_PATH}`);
  }

  const accounts = loadAccounts();

  const raw = fs.readFileSync(QUEUE_PATH, "utf8");
  const { headers, data } = parseCsv(raw);

  const required = [
    "queue_id", "account_name", "source_text", "source_note", "rewrite_format",
    "status", "scheduled_at", "generated_text", "posted_url", "created_at",
    "drafted_at", "posted_at", "ollama_model", "ollama_url", "error"
  ];

  for (const h of required) {
    if (!headers.includes(h)) headers.push(h);
  }

  let processed = 0;
  const logs = [];

  for (const row of data) {
    if (processed >= POST_BATCH_LIMIT) break;

    const status = String(row.status || "").trim().toLowerCase();
    if (status !== "approved") continue;

    try {
      const accountName = String(row.account_name || "").trim();
      const account = accounts.get(accountName);
      if (!account) throw new Error(`No matching account in accounts.csv: ${accountName}`);

      const text = String(row.generated_text || "").trim();
      if (!text) throw new Error("generated_text is empty");
      if (text.length > 280) throw new Error(`generated_text is ${text.length} chars, over 280`);

      const token = getTokenForAccount(account);
      const result = await postToX(token, text);

      row.status = "posted";
      row.posted_url = result.posted_url;
      row.posted_at = nowIso();
      row.error = "";
      processed++;

      logs.push({ queue_id: row.queue_id, account_name: accountName, status: "posted", posted_url: row.posted_url });

      if (POST_DELAY_MS > 0 && processed < POST_BATCH_LIMIT) {
        await sleep(POST_DELAY_MS);
      }
    } catch (err) {
      row.status = "failed";
      row.error = String(err.message || err);
      logs.push({ queue_id: row.queue_id, account_name: row.account_name, status: "failed", error: row.error });
    }
  }

  const tmpPath = QUEUE_PATH + ".tmp";
  fs.writeFileSync(tmpPath, toCsv(headers, data), "utf8");
  fs.renameSync(tmpPath, QUEUE_PATH);

  console.log(JSON.stringify({
    ok: true,
    queue_path: QUEUE_PATH,
    accounts_path: ACCOUNTS_PATH,
    processed,
    logs
  }, null, 2));
})().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err.stack || err) }, null, 2));
  process.exit(1);
});
