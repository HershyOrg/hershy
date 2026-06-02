/**
 * generate_drafts.js
 * Reads /files/queue.csv, finds rows with status=queued, generates drafts with local Ollama,
 * then updates those rows to status=drafted.
 *
 * Run inside n8n Execute Command:
 *   node /files/scripts/generate_drafts.js
 */

const fs = require("fs");

const QUEUE_PATH = process.env.QUEUE_PATH || "/files/queue.csv";
const BATCH_LIMIT = Number(process.env.DRAFT_BATCH_LIMIT || 10);
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || "http://172.17.0.1:11434/api/generate";

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

function buildPrompt(row) {
  const accountName = row.account_name || "default_account";
  const sourceText = row.source_text || "";
  const sourceNote = row.source_note || "";
  const rewriteFormat = row.rewrite_format || "한국어 X 포스트. 260자 이하. 원문 문장/구조를 베끼지 말고 새 관점을 추가.";

  return `You are drafting an original X post for this account.

Account name:
${accountName}

Source note:
${sourceNote}

User rewrite format:
${rewriteFormat}

Source text:
${sourceText}

Rules:
- Do not copy the source phrasing.
- Do not paraphrase sentence-by-sentence.
- Use the source only as raw material.
- Add a new angle, interpretation, critique, example, or founder insight.
- Do not invent facts.
- Follow the user's format exactly.
- Keep it suitable for X/Twitter.
- Write only the final post text. No explanation.`;
}

async function callOllama(row, prompt) {
  const ollamaUrl = row.ollama_url || DEFAULT_OLLAMA_URL;
  const model = row.ollama_model || DEFAULT_OLLAMA_MODEL;

  const res = await fetch(ollamaUrl, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      model,
      prompt,
      stream: false
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = await res.json();
  return String(json.response || json.output || "").trim();
}

(async () => {
  if (!fs.existsSync(QUEUE_PATH)) {
    throw new Error(`Missing queue file: ${QUEUE_PATH}`);
  }

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
    if (processed >= BATCH_LIMIT) break;

    const status = String(row.status || "").trim().toLowerCase();
    if (status !== "queued") continue;

    try {
      if (!String(row.source_text || "").trim()) {
        throw new Error("source_text is empty");
      }

      const prompt = buildPrompt(row);
      let draft = await callOllama(row, prompt);
      draft = draft.replace(/^["']|["']$/g, "").trim();

      if (draft.length > 280) {
        draft = draft.slice(0, 277).trimEnd() + "...";
      }

      row.generated_text = draft;
      row.status = "drafted";
      row.drafted_at = nowIso();
      row.error = "";
      processed++;

      logs.push({ queue_id: row.queue_id, account_name: row.account_name, status: "drafted", generated_text: draft });
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
    processed,
    logs
  }, null, 2));
})().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err.stack || err) }, null, 2));
  process.exit(1);
});
