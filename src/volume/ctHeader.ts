// The NLM's CT header texts, one per slice: a GE scanner's header dumped as "label....: value" lines, with the
// image's geometry among hundreds of other fields. A few bytes of the dump are control characters (three or four in
// each of the male's, mostly NULs), so a file is read as latin1 and those are stripped before the lines are matched.
// The labels are matched without regard to case or spacing, and the dotted leaders between a label and its colon are
// dropped

export interface CtHeader {
  // The display field of view across the image, in millimetres
  dfovMm: number
  // Millimetres across a pixel, from the header's own figure, which rounds dfovMm / size
  pixelMm: number
  // The image matrix, columns then rows
  size: readonly [number, number]
  // The centre of the image plane in the scanner's right-anterior-superior frame, in millimetres
  centerRAS: readonly [number, number, number]
  // The table's start location for the scan, in millimetres
  tablePosition: number
  sliceThickness: number
  // The scan the slice came from and how the body went into the scanner, such as "Head First": slices from different
  // scans, or entered differently, don't share a geometry even at one field of view
  exam: string
  entry: string
}

// Control characters other than tab, newline and carriage return
const controlCharacters = /[^\P{Cc}\t\n\r]/gu

// A label as a key: lower case, the leader dots gone, runs of spaces collapsed
const keyOf = (label: string) => label.replace(/\.+$/, '').trim().toLowerCase().replace(/\s+/g, ' ')

// Every "label....: value" line of the text as a map, the first occurrence of a label winning
export function headerFields(text: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of text.replace(controlCharacters, '').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = keyOf(line.slice(0, colon))
    if (key === '' || fields.has(key)) continue
    fields.set(key, line.slice(colon + 1).trim())
  }
  return fields
}

// A header's geometry. The file name, where given, names the header in any error
export function parseCtHeader(text: string, file = 'the CT header'): CtHeader {
  const fields = headerFields(text)
  // A field's leading number, where the field is present and not empty
  const number = (label: string): number | null => {
    const value = fields.get(label)
    if (value === undefined || value === '') return null
    const parsed = Number(value.split(/\s+/)[0])
    if (!Number.isFinite(parsed)) throw new Error(`${file}'s "${label}" is ${JSON.stringify(value)}, not a number`)
    return parsed
  }
  const required = (label: string): number => {
    const value = number(label)
    if (value === null) throw new Error(`${file} has no "${label}" field`)
    return value
  }

  const dfovMm = required('display field of view - x (mm)')
  if (!(dfovMm > 0)) throw new Error(`${file}'s display field of view is ${dfovMm} mm`)
  const columns = required('image matrix size - x')
  const rows = required('image matrix size - y')
  if (!(columns > 0 && rows > 0)) throw new Error(`${file}'s image matrix is ${columns} × ${rows}`)
  const pixelMm = number('image pixel size - x') ?? dfovMm / columns
  if (!(pixelMm > 0)) throw new Error(`${file}'s pixel size is ${pixelMm} mm`)
  return {
    dfovMm,
    pixelMm,
    size: [columns, rows],
    centerRAS: [
      required('center r coord of plane image'),
      required('center a coord of plane image'),
      required('center s coord of plane image'),
    ],
    tablePosition: required('table start location'),
    sliceThickness: required('slice thickness (mm)'),
    exam: fields.get('exam number') ?? '',
    // The field reads as a code and its name, "1    Head First"; the name is kept
    entry: (fields.get('patient entry') ?? '').replace(/^\d+\s*/, ''),
  }
}
