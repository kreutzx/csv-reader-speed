// solve.js — a fast drop-in replacement for csv-reader 1.0.0, written for
// csv-reader-speed-01: run(input) returns exactly csv-reader's answer
// {columns, rows, errors} for every input, in a fraction of the CPU.
//
// How it is faster than the reference's character-at-a-time reading:
//  - Most records live on one line with no quotes and no stray CRs. Those
//    take the fast path: one indexOf finds the line end, one native split
//    cuts the fields — no per-character work at all.
//  - Unquoted fields off the fast path are scanned with indexOf hops
//    between the three special characters, slicing whole runs at once.
//  - Quoted fields hop between quote/CR/LF positions and splice slices,
//    converting CR and CRLF inside quotes to LF exactly as the reference
//    does, and falling back to its unquoted re-read when a quote never
//    closes.
// Every error the reference records — stray_cr, quote_junk,
// unterminated_quote, short_row, long_row — is recorded here too, in the
// same order, with the same line and row, and the same object shape.

const COMMA = 1;
const LINE_BREAK = 2;
const END = 3;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  const hasCR = text.indexOf("\r") !== -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null for the header). Field readers close over these.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `seed` up to the next comma or line
  // break; a CR not followed by LF is dropped with a stray_cr error.
  // Returns the field, how it ended, and how many characters were kept.
  function readUnquoted(seed) {
    let value = seed;
    let added = 0;
    while (pos < n) {
      const iComma = text.indexOf(",", pos);
      const iLf = text.indexOf("\n", pos);
      const iCr = hasCR ? text.indexOf("\r", pos) : -1;
      let j = -1;
      let kind = 0;
      if (iComma !== -1) { j = iComma; kind = COMMA; }
      if (iLf !== -1 && (j === -1 || iLf < j)) { j = iLf; kind = LINE_BREAK; }
      if (iCr !== -1 && (j === -1 || iCr < j)) { j = iCr; kind = 3; }
      if (kind === 0) {
        if (pos < n) { value += text.slice(pos, n); added += n - pos; pos = n; }
        return { value, ended: END, added };
      }
      if (j > pos) { value += text.slice(pos, j); added += j - pos; pos = j; }
      if (kind === COMMA) { pos += 1; return { value, ended: COMMA, added }; }
      if (kind === LINE_BREAK) { pos += 1; line += 1; return { value, ended: LINE_BREAK, added }; }
      // A CR: CRLF ends the field; a lone CR is dropped and reading goes on.
      if (text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      errors.push({ code: "stray_cr", line: recordLine, row: recordRow });
      pos += 1;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Fast hop: most quoted fields hold no doubled quote and no CR. The
    // closing quote is one indexOf away; the slice between is the value,
    // with any LFs inside it counted for the line number.
    const q = text.indexOf('"', pos + 1);
    if (q !== -1 && text.charCodeAt(q + 1) !== 34) {
      const seg = text.slice(pos + 1, q);
      if (seg.indexOf("\r") === -1) {
        let lf = seg.indexOf("\n");
        while (lf !== -1) { line += 1; lf = seg.indexOf("\n", lf + 1); }
        pos = q + 1;
        return afterQuoted(seg);
      }
    }
    if (q === -1) {
      // No quote remains in the text: this one never closes.
      pos = open + 1;
      line = openLine;
      errors.push({ code: "unterminated_quote", line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    let value = "";
    let segStart = pos + 1;
    pos += 1;
    let closed = false;
    while (pos < n) {
      const cc = text.charCodeAt(pos);
      if (cc === 34) { // "
        if (text.charCodeAt(pos + 1) === 34) {
          value += text.slice(segStart, pos) + '"';
          pos += 2;
          segStart = pos;
          continue;
        }
        value += text.slice(segStart, pos);
        pos += 1;
        closed = true;
        break;
      }
      if (cc === 13) { // CR or CRLF inside quotes reads as one LF
        value += text.slice(segStart, pos) + "\n";
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        segStart = pos;
        continue;
      }
      if (cc === 10) line += 1;
      pos += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as an unquoted field.
      pos = open + 1;
      line = openLine;
      errors.push({ code: "unterminated_quote", line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    return afterQuoted(value);
  }

  // A quoted field has closed and pos sits just past its closing quote:
  // the field ends at a comma, at a line break or at the end of the text,
  // or whatever follows is appended to it as junk (quote_junk).
  function afterQuoted(value) {
    if (pos >= n) return { value, ended: END };
    const cc = text.charCodeAt(pos);
    if (cc === 44) { pos += 1; return { value, ended: COMMA }; }
    if (cc === 10) { pos += 1; line += 1; return { value, ended: LINE_BREAK }; }
    if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: "quote_junk", line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) { pos += 1; line += 1; }
      else if (cc === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the whole record is one line holding no quote and no CR
    // but its ending CRLF — split it natively. The line is sliced first so
    // every scan here is bounded by the line's own length.
    const eol = text.indexOf("\n", pos);
    const lineEnd = eol === -1 ? n : eol;
    let segEnd = lineEnd;
    if (eol !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    const seg = text.slice(pos, segEnd);
    let fields = null;
    let lastQuoted = false;
    if (seg.indexOf('"') === -1 && seg.indexOf("\r") === -1) {
      fields = seg.split(",");
      pos = eol === -1 ? n : eol + 1;
      if (eol !== -1) line += 1;
    }

    if (fields === null) {
      fields = [];
      let ended = END;
      do {
        lastQuoted = text.charCodeAt(pos) === 34;
        const field = lastQuoted ? readQuoted() : readUnquoted("");
        fields.push(field.value);
        ended = field.ended;
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === "" && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: "short_row", line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push("");
    } else if (fields.length > width) {
      errors.push({ code: "long_row", line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
