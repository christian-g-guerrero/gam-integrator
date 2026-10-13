# Mailbox export — JSONL archive format (schema v2)

The contract for downstream importers of **Email audit → Browse mailbox → Export mailbox → JSONL**. Code: `server/src/mailExport.ts` (pipeline) · `server/src/gam/mailArchive.ts` (record builder) · golden-fixture tests in `server/src/gam/mailArchive.test.ts`.

## The download

JSONL exports always arrive as a **ZIP**:

```
mailbox.jsonl          one v2 record per line (UTF-8, LF line endings between records)
manifest.json          provenance + completeness (below) — the file's sha256 lives here, not in the file
attachments/<id>/      only with "+ attachments": att-<n>-<filename> per file (<id> = Gmail message id)
```

A ZIP named `…-PARTIAL.zip` is incomplete — but **trust `manifest.json → complete`, not the filename** (filenames get renamed).

## How it's built (why it's lossless)

1. **Metadata pass** — `gam config csv_output_no_escape_char true user X print messages max_to_print 0 headers message-id showlabels delimiter \x1f showsize showsnippet showdate` → ids, thread ids, labels, size, snippet, internalDate (fields only the Gmail API has).
2. **Raw pass** — `gam user X export messages ids <chunk>` → each message's original RFC 822 source (`format=raw`), chunked, with missing ids re-requested up to 3×.
3. **Build** — each `.eml` is parsed with [postal-mime](https://github.com/postalsys/postal-mime); bodies and headers come from the message itself, never from a CSV round-trip. Raw `.eml` files are discarded.

## Record (v2)

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `2` | On every record. v1 exports (older, unversioned) have no such field. |
| `mailbox` | string | The exported user. |
| `id`, `thread_id` | string | Gmail ids — **per mailbox**; use `message_id` to dedupe across mailboxes. |
| `internal_date` | ISO string \| null | Gmail `internalDate` (receive time) — what live Gmail sync keys on. **Second precision** (GAM truncates the ms). |
| `date` / `date_iso` | string \| null | The `Date:` header (send time), raw and normalized to UTC ISO. |
| `message_id` | string \| null | `<…@…>` form. Falls back to the metadata pass if the raw fetch failed. |
| `in_reply_to` | string \| null | First `<…>` of `In-Reply-To`. |
| `references` | string[] | All `<…>` ids of `References`, in order. |
| `from`, `sender`, `to`, `cc`, `bcc`, `reply_to` | `{name, email}[]` | RFC 5322-parsed. Groups are flattened to their members; entries with no usable address (e.g. `undisclosed-recipients:;`) are dropped. Case preserved. |
| `delivered_to` | string[] | Every `Delivered-To:` address. |
| `headers_raw` | object | The raw header values (RFC 2047 words still encoded, folding removed) for `from sender to cc bcc reply-to delivered-to subject date message-id in-reply-to references`. Nothing the parser dropped is lost. |
| `subject` | string \| null | Decoded. |
| `snippet` | string \| null | Gmail's snippet. **Already HTML-unescaped by GAM** (`it's`, not `it&#39;s`) — unlike the raw Gmail API. |
| `labels` | `{id, name}[]` | System labels have `id == name` (`INBOX`, `SENT`, `CATEGORY_*`); user labels e.g. `{id:"Label_12", name:"Clients - North"}`. |
| `size_estimate` | number \| null | Gmail `sizeEstimate`. |
| `body_status` | enum | `ok` (text and/or HTML present) · `empty` (no text/HTML part, e.g. attachment-only) · `unavailable` (raw fetch failed — see manifest `failed_ids`) · `parse_error`. |
| `body_text` | string \| null | The `text/plain` part, byte-exact (CRLF, blank lines, backslashes preserved). **Never HTML and never synthesized** — null when absent. |
| `body_html` | string \| null | The `text/html` part. |
| `body_text_stripped` | string \| null | Convenience only: `body_text` (LF-normalized) with quoted reply/forward history cut. Heuristic — derive your own if it matters. |
| `attachments` | array | `{attachment_id, name, mime_type, size, sha256, inline, content_id, path}`. `attachment_id` is `att-<n>` in MIME order — stable, unlike Gmail's own attachmentId, which changes on every API call. `path` is the file inside the ZIP, or null for exports without attachment files; `sha256`/`size` are always of the decoded bytes. `inline` = embedded image (cid). |

## manifest.json

| Field | Notes |
| --- | --- |
| `schema_version`, `complete` | `complete: false` ⇒ some messages are missing or body-less — see `failed_ids`. |
| `mailbox`, `exported_at`, `exporter{name,version,commit}` | Provenance. |
| `format`, `query`, `include_spam_trash`, `include_attachments` | What was asked for. `query` is `in:anywhere` when Spam/Trash were included. |
| `message_count` | Lines in `mailbox.jsonl` (= `files[0].lines`). |
| `gmail_messages_total` | Gmail profile `messagesTotal` (All Mail **incl.** Spam/Trash) — reconcile against `message_count`. |
| `failed_ids` | Messages that failed to list, fetch or parse after retries. |
| `attachment_count`, `attachment_bytes` | Totals across `attachments[]`. |
| `gam_commands` | The GAM invocations run (id lists and local paths elided). |
| `files[]` | `{path, bytes, sha256, lines}` — verify the JSONL wasn't truncated or altered. |

## CSV exports

CSV is GAM's spreadsheet output (one row per message via `convertcrnl`). It is **not** lossless: a literal `\n` typed in an email is indistinguishable from a flattened line break. Labels are `|`-separated. "CSV + attachments" ZIPs add `attachments/<id>/…`, `attachments.csv` (message id → file, sha256), and the same `manifest.json` (without `lines`). Use JSONL for archives and imports.
