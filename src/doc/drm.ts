/** Font-obfuscation "encryption" is not DRM and must be allowed. */
const FONT_OBFUSCATION = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
])

/** MOBI/AZW: PalmDOC header in record 0 has a 2-byte encryption field at offset 12. */
export async function isMobiDrm(file: Blob): Promise<boolean> {
  const head = new DataView(await file.slice(0, 86).arrayBuffer())
  if (head.byteLength < 82) return false
  const rec0 = head.getUint32(78)
  const rec = new DataView(await file.slice(rec0, rec0 + 14).arrayBuffer())
  if (rec.byteLength < 14) return false
  return rec.getUint16(12) !== 0
}

/** EPUB: rights.xml present, or encryption.xml lists any non-font-obfuscation algorithm. */
export function isEpubDrm(encryptionXml: string | null, hasRightsXml: boolean): boolean {
  if (hasRightsXml) return true
  if (!encryptionXml) return false
  const doc = new DOMParser().parseFromString(encryptionXml, 'application/xml')
  const methods = Array.from(doc.getElementsByTagNameNS('*', 'EncryptionMethod'))
  return methods.some(m => !FONT_OBFUSCATION.has(m.getAttribute('Algorithm') ?? ''))
}
