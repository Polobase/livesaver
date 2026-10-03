/** Numbers and times as the app writes them. */

const integer = new Intl.NumberFormat('en-US')

export const count = (n: number): string => integer.format(n)

/** `3 sets`, `1 set`, `2 libraries` (`many` where a plural is not the word plus s). */
export const plural = (n: number, word: string, many = `${word}s`): string =>
  `${count(n)} ${n === 1 ? word : many}`

/** Decimal units, as Finder shows sizes. */
export function bytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`
  return `${n} bytes`
}

export function percent(part: number, whole: number): string {
  if (whole === 0 || part === 0) return '0%'
  const p = (part / whole) * 100
  return p < 0.1 ? '<0.1%' : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** When something happened, as short as it can be said: `14:30` today, `3 Oct, 14:30` before. */
export function when(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay ? time.format(date) : `${day.format(date)}, ${time.format(date)}`
}

const full = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** The parts of a date by name: how they are joined differs between browsers, so the app joins them. */
function partsOf(at: Date): Record<string, string> {
  return Object.fromEntries(full.formatToParts(at).map((part) => [part.type, part.value]))
}

/** A moment in full, for where the year matters: `3 October 2026, 14:30`. */
export function moment(at: Date): string {
  if (Number.isNaN(at.getTime())) return ''
  const p = partsOf(at)
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`
}

/** A day in full: `Saturday, 3 October 2026`. */
export function dayName(at: Date): string {
  if (Number.isNaN(at.getTime())) return ''
  const p = partsOf(at)
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`
}

export function seconds(s: number): string {
  return s < 10 ? `${s.toFixed(1)} s` : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`
}

/** The last part of a path, and what leads to it (a set may store a path from Windows). */
export function splitPath(path: string): { folder: string; name: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at < 0
    ? { folder: '', name: path }
    : { folder: path.slice(0, at), name: path.slice(at + 1) }
}
