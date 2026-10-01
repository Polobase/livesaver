/**
 * CSV the way Python's `csv` module reads and writes it (excel dialect), for report files and for
 * the sheets people edit in spreadsheet programs (rating sheet, move and reorg plans).
 */

export type CsvValue = string | number

/** One field as `csv.writer` (QUOTE_MINIMAL) writes it. */
export function csvField(value: CsvValue, delimiter = ','): string {
  const s = String(value)
  const quote = s.includes(delimiter) || s.includes('"') || s.includes('\r') || s.includes('\n')
  return quote ? `"${s.replaceAll('"', '""')}"` : s
}

/** One record with its `\r\n` terminator; a record of one empty field is written as `""`. */
export function csvLine(row: readonly CsvValue[], delimiter = ','): string {
  if (row.length === 1 && String(row[0]) === '') return '""\r\n'
  return `${row.map((v) => csvField(v, delimiter)).join(delimiter)}\r\n`
}

/** A whole file as Python writes it with `encoding="utf-8-sig"` (byte order mark first). */
export function formatCsv(
  rows: readonly (readonly CsvValue[])[],
  options: { bom?: boolean } = {},
): string {
  return (options.bom === false ? '' : '\ufeff') + rows.map((r) => csvLine(r)).join('')
}

/**
 * Records of a CSV text (`csv.reader`, excel dialect): quoted fields may hold delimiters, quotes
 * (`""`) and line breaks; lines end with `\n`, `\r\n` or `\r`. Empty lines give empty records.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  // The states of CPython's _csv.c reader.
  type State = 'record' | 'field' | 'unquoted' | 'quoted' | 'quote'
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let state: State = 'record'
  const save = () => {
    row.push(field)
    field = ''
  }
  const end = () => {
    rows.push(row)
    row = []
    state = 'record'
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    const newline = c === '\n' || c === '\r'
    if (c === '\r' && text[i + 1] === '\n' && state !== 'quoted') i++ // CRLF ends one line
    if (state === 'record') {
      if (newline) {
        rows.push([]) // an empty line
        continue
      }
      state = 'field'
    }
    switch (state) {
      case 'field':
        if (newline) {
          save()
          end()
        } else if (c === '"') state = 'quoted'
        else if (c === delimiter) save()
        else {
          field += c
          state = 'unquoted'
        }
        break
      case 'unquoted':
        if (newline) {
          save()
          end()
        } else if (c === delimiter) {
          save()
          state = 'field'
        } else field += c
        break
      case 'quoted':
        if (c === '"') state = 'quote'
        else field += c
        break
      case 'quote':
        if (c === '"') {
          field += '"'
          state = 'quoted'
        } else if (c === delimiter) {
          save()
          state = 'field'
        } else if (newline) {
          save()
          end()
        } else {
          field += c // text after a closing quote is kept (non-strict)
          state = 'unquoted'
        }
        break
    }
  }
  if (state !== 'record') {
    save()
    rows.push(row)
  }
  return rows
}

/**
 * Records keyed by the header row (`csv.DictReader`): empty records are skipped, missing fields are
 * `undefined`. A byte order mark at the start is ignored (`utf-8-sig`).
 */
export function csvRecords(
  text: string,
  delimiter = ',',
): { header: string[]; records: Record<string, string | undefined>[] } {
  const rows = parseCsv(text.startsWith('\ufeff') ? text.slice(1) : text, delimiter)
  const header = rows.shift() ?? []
  const records: Record<string, string | undefined>[] = []
  for (const row of rows) {
    if (row.length === 0) continue
    const record: Record<string, string | undefined> = Object.create(null)
    header.forEach((name, i) => {
      record[name] = row[i]
    })
    records.push(record)
  }
  return { header, records }
}

/** The delimiter a spreadsheet program used: the most frequent of `,` `;` and tab in the header. */
export function sniffDelimiter(text: string): string {
  const header = (text.startsWith('\ufeff') ? text.slice(1) : text).split('\n', 1)[0] ?? ''
  let best = ','
  let most = -1
  for (const d of [',', ';', '\t']) {
    const count = header.split(d).length - 1
    if (count > most) {
      best = d
      most = count
    }
  }
  return best
}
