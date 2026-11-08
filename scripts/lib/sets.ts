// The one table of the NLM's sets this project mirrors, in the order they're fetched: the core sets first, then the
// 70 mm film scans, which are archived and read by nothing. Each set is one folder of the data root, named by its id;
// the head's MRI series are a folder each under head-mri/ and head-mri-dicom/, because their file names collide.

import type { ListedFile } from './listing.ts'

export const baseUrl = 'https://data.lhncbc.nlm.nih.gov/public/Visible-Human'

// How a folder's files are named: every number from first to last, padded to digits, with each suffix in turn, less
// the absent names. A source without a rule wants every file its listing shows
export interface NameRule {
  prefix: string
  first: number
  last: number
  digits: number
  suffixes?: readonly string[]
  extension: string
  absent?: readonly string[]
}

// One or more NLM folders, relative to baseUrl, that list the same kind of file. Where a name is listed in two
// folders, it's the same file, taken from the first
export interface Source {
  folders: readonly string[]
  names?: NameRule
}

export interface DataSet {
  id: string
  sources: readonly Source[]
  expected: number
  kind: 'core' | 'archive'
}

export interface WantedFile {
  name: string
  folder: string
  bytes: number | null
}

const male = 'Male-Images/PNG_format'
const female = 'Female-Images/PNG_format'
const head = 'Additional-Head-Images'
const regions = ['head', 'thorax', 'abdomen', 'pelvis', 'thighs', 'legs'] as const

// The head's four MRI series: proton density, T1, T2 at 256 × 256, and T2 at 512 × 512
const mriSeries = [
  { series: 'PD', count: 76 },
  { series: 'T1', count: 76 },
  { series: 'T2', count: 76 },
  { series: 'T2_512', count: 229 },
] as const

const numbered = (prefix: string, first: number, last: number, digits: number, extension: string): NameRule => ({
  prefix,
  first,
  last,
  digits,
  extension,
})

export const sets: readonly DataSet[] = [
  {
    id: 'male-colour',
    sources: [{ folders: regions.map((r) => `${male}/${r}`), names: numbered('a_vm', 1001, 2878, 4, '.png') }],
    expected: 1878,
    kind: 'core',
  },
  {
    id: 'male-ct',
    sources: [
      { folders: [`${male}/radiological/frozenCT`], names: numbered('cvm', 1006, 2882, 4, 'f.png') },
      { folders: [`${male}/radiological/frozenCTHeaders`], names: numbered('cvm', 1006, 2882, 4, 'f.txt') },
    ],
    expected: 1877 * 2,
    kind: 'core',
  },
  {
    id: 'male-mri',
    sources: [{ folders: [`${male}/radiological/mri`] }, { folders: [`${male}/radiological/mriHeaders`] }],
    expected: 1029 * 2,
    kind: 'core',
  },
  {
    id: 'female-colour',
    sources: [
      {
        folders: regions.map((r) => `${female}/${r}`),
        // Three sub-slices to a number; the NLM has none for these four
        names: {
          ...numbered('avf', 1001, 2730, 4, '.png'),
          suffixes: ['a', 'b', 'c'],
          absent: ['avf2328c.png', 'avf2329a.png', 'avf2329b.png', 'avf2730c.png'],
        },
      },
    ],
    expected: 5186,
    kind: 'core',
  },
  {
    id: 'female-ct',
    sources: [
      { folders: [`${female}/radiological/normalCT`], names: numbered('cvf', 1001, 2734, 4, 'f.png') },
      { folders: [`${female}/radiological/normalCTHeaders`], names: numbered('c_vf', 1001, 2734, 4, '.txt') },
    ],
    expected: 1734 * 2,
    kind: 'core',
  },
  {
    id: 'female-mri',
    sources: [{ folders: [`${female}/radiological/mri`] }, { folders: [`${female}/radiological/mriHeaders`] }],
    expected: 986 + 985,
    kind: 'core',
  },
  {
    id: 'head-cryo',
    sources: [{ folders: [`${head}/cryo/tiff`], names: numbered('', 1, 1477, 4, '.tiff.gz') }],
    expected: 1477,
    kind: 'core',
  },
  {
    id: 'head-cryo-jpeg',
    sources: [{ folders: [`${head}/cryo/jpeg/quarterSize/axial`], names: numbered('', 1, 1477, 4, '.04.jpg') }],
    expected: 1477,
    kind: 'core',
  },
  {
    id: 'head-cat',
    sources: [{ folders: [`${head}/MR_CT_tiffs/CAT-tiff`], names: numbered('', 1, 463, 1, '.tif.gz') }],
    expected: 463,
    kind: 'core',
  },
  {
    id: 'head-cat-dicom',
    sources: [{ folders: [`${head}/MR_CT_DICOM/CAT`], names: numbered('J.', 1, 463, 3, '.gz') }],
    expected: 463,
    kind: 'core',
  },
  ...mriSeries.flatMap(({ series, count }): DataSet[] => [
    {
      id: `head-mri/${series}`,
      sources: [
        { folders: [`${head}/MR_CT_tiffs/MRI-tiff/${series}-tiff`], names: numbered('', 1, count, 1, '.tif.gz') },
      ],
      expected: count,
      kind: 'core',
    },
    {
      id: `head-mri-dicom/${series}`,
      sources: [{ folders: [`${head}/MR_CT_DICOM/MRI/${series}`], names: numbered('I.', 1, count, 3, '.gz') }],
      expected: count,
      kind: 'core',
    },
  ]),
  {
    id: 'male-70mm',
    sources: [{ folders: ['Male-Images/70mm/fullbody'], names: numbered('', 1001, 2878, 4, '.rgb.gz') }],
    expected: 1878,
    kind: 'archive',
  },
  // Frames 1001 to 6189 and a 1713b
  {
    id: 'female-70mm-2k',
    sources: [{ folders: ['Female-Images/70mm/2K_PNG-Images'] }],
    expected: 5190,
    kind: 'archive',
  },
  {
    id: 'female-70mm-4k',
    sources: [{ folders: ['Female-Images/70mm/4K_Tiff-Images'] }],
    expected: 5190,
    kind: 'archive',
  },
]

// The sets a --set value names: none means the core sets, "all" every set, and otherwise a comma-separated list of
// ids, where a folder such as head-mri stands for every series under it
export function selectSets(value: string | undefined): DataSet[] {
  if (value === undefined) return sets.filter((set) => set.kind === 'core')
  if (value === 'all') return [...sets]
  const names = value.split(',').map((name) => name.trim().replace(/\/+$/, ''))
  const chosen = new Set<DataSet>()
  for (const name of names) {
    const matches = sets.filter((set) => set.id === name || set.id.startsWith(`${name}/`))
    if (matches.length === 0) {
      throw new Error(`No set is called ${name}; the sets are ${sets.map((set) => set.id).join(', ')} and all`)
    }
    for (const set of matches) chosen.add(set)
  }
  // In the table's order, whatever order they were asked in
  return sets.filter((set) => chosen.has(set))
}

export function ruleNames(rule: NameRule): string[] {
  const absent = new Set(rule.absent)
  const names: string[] = []
  for (let n = rule.first; n <= rule.last; n++) {
    for (const suffix of rule.suffixes ?? ['']) {
      const name = `${rule.prefix}${String(n).padStart(rule.digits, '0')}${suffix}${rule.extension}`
      if (!absent.has(name)) names.push(name)
    }
  }
  return names
}

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

// The files a set wants, from its folders' listings: a rule's names in its order, or every listed name in number order.
// names is every wanted name in that order, unlisted the names a rule wants that no listing shows, and unexpected the
// listed names a rule doesn't form, which are left alone
export function wantedFiles(set: DataSet, listings: ReadonlyMap<string, readonly ListedFile[]>) {
  const names: string[] = []
  const files: WantedFile[] = []
  const unlisted: string[] = []
  const unexpected: string[] = []
  for (const source of set.sources) {
    const listed = new Map<string, WantedFile>()
    for (const folder of source.folders) {
      const listing = listings.get(folder)
      if (!listing) throw new Error(`The listing of ${folder} wasn't read`)
      for (const { name, bytes } of listing) if (!listed.has(name)) listed.set(name, { name, folder, bytes })
    }
    if (!source.names) {
      const sorted = [...listed.values()].sort((a, b) => byNumber(a.name, b.name))
      files.push(...sorted)
      names.push(...sorted.map((file) => file.name))
      continue
    }
    const formed = ruleNames(source.names)
    names.push(...formed)
    for (const name of formed) {
      const file = listed.get(name)
      if (file) files.push(file)
      else unlisted.push(name)
    }
    const known = new Set(formed)
    unexpected.push(...[...listed.keys()].filter((name) => !known.has(name)).sort(byNumber))
  }
  return { names, files, unlisted, unexpected }
}
