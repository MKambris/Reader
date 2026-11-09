// Minimal typings for the vendored foliate-js format modules we use.
declare module '*/foliate-js/epub.js' {
  export class EPUB {
    constructor(loader: unknown)
    init(): Promise<FoliateBook>
  }
}
declare module '*/foliate-js/mobi.js' {
  export function isMOBI(file: Blob): Promise<boolean>
  export class MOBI {
    constructor(opts: { unzlib: (d: Uint8Array) => Uint8Array })
    open(file: Blob): Promise<FoliateBook>
  }
}
declare module '*/foliate-js/fb2.js' {
  export function makeFB2(blob: Blob): Promise<FoliateBook>
}
declare module '*/foliate-js/vendor/zip.js' {
  export const configure: (o: object) => void
  export class ZipReader { constructor(r: unknown); getEntries(): Promise<any[]> }
  export class BlobReader { constructor(b: Blob) }
  export class TextWriter {}
  export class BlobWriter { constructor(type?: string) }
}
declare module '*/foliate-js/vendor/fflate.js' {
  export const unzlibSync: (d: Uint8Array) => Uint8Array
}

interface FoliateBook {
  metadata?: { title?: unknown; author?: unknown }
  sections: {
    id?: string | number
    createDocument?: () => Document | Promise<Document>
    resolveHref?: (href: string) => string
    linear?: string
  }[]
}
