export class DrmError extends Error {
  constructor() {
    super("This file is DRM-protected and can't be opened.")
    this.name = 'DrmError'
  }
}

export class NoTextError extends Error {
  constructor() {
    super('This PDF has no readable text (scanned image).')
    this.name = 'NoTextError'
  }
}

export class UnsupportedTypeError extends Error {
  constructor(ext: string) {
    super(`Unsupported file type: .${ext || '?'}`)
    this.name = 'UnsupportedTypeError'
  }
}
