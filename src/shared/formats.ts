// Every file format Glimmr imports: its extensions, a readable name, and whether it's a camera raw file.
// The scanner, search (`type:`), the File type filter and the editor rules all read this one table.

export interface FileFormat {
  /** Stable id, used in searches (`type:cr3`) and the filter. */
  id: string
  /** Short name, e.g. "CR3" or "JPEG". */
  name: string
  /** Who makes it or what it is, e.g. "Canon raw" or "Photoshop". */
  description: string
  exts: string[]
  raw: boolean
}

const raw = (id: string, maker: string, exts: string[] = [id]): FileFormat => ({
  id,
  name: id.toUpperCase(),
  description: `${maker} raw`,
  exts,
  raw: true
})
const image = (id: string, name: string, description: string, exts: string[]): FileFormat => ({ id, name, description, exts, raw: false })

export const FORMATS: FileFormat[] = [
  image('jpeg', 'JPEG', 'JPEG image', ['jpg', 'jpeg', 'jpe', 'jfif']),
  image('heic', 'HEIC', 'High Efficiency Image (iPhone, Canon, Fujifilm, Sony)', ['heic', 'heif', 'hif']),
  image('avif', 'AVIF', 'AV1 image', ['avif']),
  image('jxl', 'JPEG XL', 'JPEG XL image', ['jxl']),
  image('png', 'PNG', 'PNG image', ['png']),
  image('tiff', 'TIFF', 'TIFF image', ['tif', 'tiff']),
  image('webp', 'WebP', 'WebP image', ['webp']),
  image('gif', 'GIF', 'GIF image', ['gif']),
  image('bmp', 'BMP', 'Windows bitmap', ['bmp', 'dib']),
  image('psd', 'PSD', 'Photoshop document', ['psd', 'psb']),
  {
    id: 'dng',
    name: 'DNG',
    description: 'Adobe Digital Negative (raw)',
    exts: ['dng'],
    raw: true
  },
  raw('cr3', 'Canon'),
  raw('cr2', 'Canon'),
  raw('crw', 'Canon'),
  raw('nef', 'Nikon'),
  raw('nrw', 'Nikon'),
  raw('arw', 'Sony'),
  raw('srf', 'Sony'),
  raw('sr2', 'Sony'),
  raw('raf', 'Fujifilm'),
  raw('orf', 'Olympus / OM System'),
  raw('ori', 'Olympus / OM System'),
  raw('rw2', 'Panasonic'),
  raw('raw', 'Panasonic / Leica'),
  raw('rwl', 'Leica'),
  raw('pef', 'Pentax'),
  raw('ptx', 'Pentax'),
  raw('srw', 'Samsung'),
  raw('x3f', 'Sigma'),
  raw('3fr', 'Hasselblad'),
  raw('fff', 'Hasselblad'),
  raw('iiq', 'Phase One'),
  raw('cap', 'Phase One'),
  raw('eip', 'Phase One'),
  raw('mos', 'Leaf'),
  raw('mef', 'Mamiya'),
  raw('erf', 'Epson'),
  raw('gpr', 'GoPro'),
  raw('mrw', 'Minolta'),
  raw('mdc', 'Minolta'),
  raw('kdc', 'Kodak'),
  raw('dcr', 'Kodak'),
  raw('dcs', 'Kodak'),
  raw('drf', 'Kodak'),
  raw('k25', 'Kodak'),
  raw('bay', 'Casio'),
  raw('cs1', 'Sinar'),
  raw('sti', 'Sinar'),
  raw('rdc', 'Ricoh'),
  raw('rwz', 'Rawzor')
]

const BY_EXT = new Map(FORMATS.flatMap((f) => f.exts.map((e) => [e, f] as const)))
const BY_ID = new Map(FORMATS.map((f) => [f.id, f]))

/** Lowercase extensions of camera raw files. */
export const RAW_EXTS = new Set(FORMATS.filter((f) => f.raw).flatMap((f) => f.exts))
/** Lowercase extensions of every supported file. */
export const SUPPORTED_EXTS = new Set(BY_EXT.keys())

export const formatOfExt = (ext: string): FileFormat | undefined => BY_EXT.get(ext.toLowerCase().replace(/^\./, ''))
export const formatById = (id: string): FileFormat | undefined => BY_ID.get(id.toLowerCase())

/** A format by id, extension or a common alias ("jpg", "heif", "tif", "photoshop"). */
export function findFormat(v: string): FileFormat | undefined {
  const k = v.toLowerCase().replace(/^\./, '')
  return BY_ID.get(k) ?? BY_EXT.get(k) ?? (k === 'photoshop' ? BY_ID.get('psd') : k === 'jpegxl' || k === 'jpeg-xl' ? BY_ID.get('jxl') : undefined)
}

/** "Canon raw (CR3)", "JPEG", "Photoshop document (PSD)". */
export function formatLabel(id: string): string {
  const f = formatById(id)
  if (!f) return id.toUpperCase()
  return f.raw ? `${f.description} (${f.name})` : f.id === 'psd' || f.id === 'bmp' ? `${f.description} (${f.name})` : f.name
}

/** SQL that maps `p.ext` to a format id, for grouping. */
export function formatIdSql(column = 'p.ext'): string {
  const cases = [...BY_EXT].filter(([e, f]) => e !== f.id).map(([e, f]) => `WHEN '${e}' THEN '${f.id}'`)
  return `CASE ${column} ${cases.join(' ')} ELSE ${column} END`
}
