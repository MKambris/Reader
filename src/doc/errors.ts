export class DrmError extends Error {
  constructor() {
    super("This file is DRM-protected and can't be opened.")
    this.name = 'DrmError'
  }
}

export class UnsupportedTypeError extends Error {
  constructor(ext: string) {
    super(`Unsupported file type: .${ext || '?'}`)
    this.name = 'UnsupportedTypeError'
  }
}
