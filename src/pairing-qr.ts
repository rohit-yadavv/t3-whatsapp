import QRCode from 'qrcode';

/** Opaque, integer-scaled modules and a generous quiet zone for phone cameras. */
export function pairingQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: 'png', scale: 8, margin: 6, errorCorrectionLevel: 'M',
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}
