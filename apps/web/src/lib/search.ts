/** Narrowing rows: every word of the search must occur in a row's text, in any case. */

export function matcher(query: string): (text: string) => boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return () => true
  return (text) => {
    const low = text.toLowerCase()
    return words.every((word) => low.includes(word))
  }
}

export interface Filter<Row> {
  readonly label: string
  readonly test: (row: Row) => boolean
}

/** The rows that pass the filter of that name and the search. */
export function narrow<Row>(
  rows: readonly Row[],
  filters: readonly Filter<Row>[],
  filter: string,
  query: string,
  text: (row: Row) => string,
): Row[] {
  const test = filters.find((f) => f.label === filter)?.test ?? (() => true)
  const matches = matcher(query)
  return rows.filter((row) => test(row) && matches(text(row)))
}
