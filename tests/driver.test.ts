import { describe, expect, it } from 'vitest'
import { chosenOptions, cupsMedia, groupOf, lpArgs, parseLpoptions, parsePpdLabels } from '../src/main/print/driver'
import { computeLayout, withDefaults } from '../src/shared/print'
import type { DriverInfo } from '../src/shared/types'

// `lpoptions -l` for a CUPS queue with three trays, as an Epson/Canon photo printer reports.
const LPOPTIONS = `PageSize/Page Size: Custom.WIDTHxHEIGHT 4x6 4x6.Borderless 5x7 8x10 A4 *Letter Legal
Duplex/2-Sided Printing: *None DuplexNoTumble DuplexTumble
ColorModel/Color Mode: Gray *RGB
Resolution/Output Resolution: 300dpi *600dpi
InputSlot/Paper Source: *Main Rear Photo
MediaType/Media Type: *Plain PhotoPaperGlossy Matte
OutputMode/Print Quality: Draft *Normal High
EPIJ_Silent/Quiet Mode: *Off On
Locked/Single: *Only`

const PPD = `*OpenUI *InputSlot/Paper Source: PickOne
*DefaultInputSlot: Main
*InputSlot Main/Main Tray: "<</MediaPosition 0>>setpagedevice"
*InputSlot Rear/Rear Paper Feed: "<</MediaPosition 1>>setpagedevice"
*InputSlot Photo/Photo Tray: "<</MediaPosition 2>>setpagedevice"
*CloseUI: *InputSlot
*OpenUI *MediaType/Paper Type: PickOne
*MediaType PhotoPaperGlossy/Premium Photo Paper Glossy: ""
*CloseUI: *MediaType`

const info = (): DriverInfo => ({
  kind: 'cups',
  printer: 'EPSON_ET_8550',
  ...parseLpoptions(LPOPTIONS, PPD)
})

describe('printer driver options', () => {
  it('lists the driver options, leaving out the ones Glimmr sets itself', () => {
    const { options, pageSizes } = parseLpoptions(LPOPTIONS)
    expect(pageSizes).toContain('4x6.Borderless')
    expect(options.map((o) => o.key)).toEqual(['InputSlot', 'MediaType', 'Resolution', 'OutputMode', 'EPIJ_Silent'])
    const slot = options[0]
    expect(slot).toMatchObject({
      label: 'Paper Source',
      group: 'source',
      defaultValue: 'Main'
    })
    expect(slot.choices.map((c) => c.value)).toEqual(['Main', 'Rear', 'Photo'])
  })

  it('takes labels from the PPD when it can be read', () => {
    const { options } = info()
    expect(options[0].choices.map((c) => c.label)).toEqual(['Main Tray', 'Rear Paper Feed', 'Photo Tray'])
    expect(options[1].label).toBe('Paper Type')
    expect(options[1].choices.find((c) => c.value === 'PhotoPaperGlossy')?.label).toBe('Premium Photo Paper Glossy')
    expect(options[1].choices.find((c) => c.value === 'Matte')?.label).toBe('Matte')
    expect(parsePpdLabels(PPD).get('InputSlot')?.label).toBe('Paper Source')
  })

  it('groups vendor option names', () => {
    expect(groupOf('InputSlot')).toBe('source')
    expect(groupOf('BRInputSlot')).toBe('source')
    expect(groupOf('CNIJMediaSupply')).toBe('source')
    expect(groupOf('MediaType')).toBe('media')
    expect(groupOf('CNIJMediaType')).toBe('media')
    expect(groupOf('cupsPrintQuality')).toBe('quality')
    expect(groupOf('HPPrintQuality')).toBe('quality')
    expect(groupOf('EPIJ_Silent')).toBe('other')
  })

  it('sends only choices the driver still offers, and not its defaults', () => {
    const s = withDefaults({
      printer: 'EPSON_ET_8550',
      driver: {
        EPSON_ET_8550: {
          InputSlot: 'Rear',
          MediaType: 'Plain',
          OutputMode: 'Gone'
        }
      }
    })
    expect(chosenOptions(s, info())).toEqual({ InputSlot: 'Rear' })
  })

  it('names the paper the way the driver does', () => {
    const sizes = info().pageSizes
    const lay = (p: Parameters<typeof withDefaults>[0]) => computeLayout(withDefaults(p), [{ id: 1, w: 3000, h: 2000 }], {})
    const letter = withDefaults({ paper: 'letter' })
    expect(cupsMedia(letter, lay(letter), sizes)).toBe('Letter')
    const borderless = withDefaults({
      paper: '4x6',
      margins: { top: 0, right: 0, bottom: 0, left: 0 }
    })
    expect(cupsMedia(borderless, lay(borderless), sizes)).toBe('4x6.Borderless')
    const a3 = withDefaults({ paper: 'a3' })
    expect(cupsMedia(a3, lay(a3), sizes)).toBe('iso_a3_297x420mm')
    const custom = withDefaults({ paper: 'custom', customW: 6, customH: 9 })
    expect(cupsMedia(custom, lay(custom), sizes)).toBe('Custom.6x9in')
  })

  it('builds the lp command', () => {
    const s = withDefaults({
      printer: 'EPSON_ET_8550',
      copies: 2,
      duplex: 'longEdge',
      grayscale: true,
      driver: {
        EPSON_ET_8550: { InputSlot: 'Photo', MediaType: 'PhotoPaperGlossy' }
      }
    })
    const args = lpArgs('/tmp/x.pdf', s, computeLayout(s, [{ id: 1, w: 3000, h: 2000 }], {}), info(), 'Beach')
    expect(args.slice(0, 6)).toEqual(['-d', 'EPSON_ET_8550', '-t', 'Beach', '-n', '2'])
    const opts = args.filter((_, i) => args[i - 1] === '-o')
    expect(opts).toEqual([
      'media=Letter',
      'print-scaling=none',
      'fit-to-page=false',
      'sides=two-sided-long-edge',
      'collate=true',
      'print-color-mode=monochrome',
      'InputSlot=Photo',
      'MediaType=PhotoPaperGlossy'
    ])
    expect(args.slice(-2)).toEqual(['--', '/tmp/x.pdf'])
  })
})
