// Reads the NLM mirror's folder listings. A folder's own URL is a 404, so each folder is read from its index.html, a
// table with one row per entry: the name as a link, the size in bytes, the date. Subfolders show "-" for both.

export interface ListedFile {
  name: string
  // null where the size cell holds no number, so the file can't be size-checked
  bytes: number | null
}

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

// The text of a cell, with its markup removed and its character references decoded
function cellText(html: string) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (reference: string, body: string) => {
      if (body[0] !== '#') return named[body.toLowerCase()] ?? reference
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return code <= 0x10ffff ? String.fromCodePoint(code) : reference
    })
    .trim()
}

// The files a listing shows, in its order. The header row has no data cells, and a subfolder's name ends in "/"
export function parseListing(html: string): ListedFile[] {
  const files: ListedFile[] = []
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cellText(cell[1]))
    if (cells.length < 2) continue
    const [name, size] = cells
    if (name === '' || name.endsWith('/') || size === '-') continue
    files.push({ name, bytes: /^\d+$/.test(size) ? Number(size) : null })
  }
  return files
}
