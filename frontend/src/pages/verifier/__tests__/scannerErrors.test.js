import { describe, expect, it } from 'vitest';
import { ChecksumException, FormatException, NotFoundException } from '@zxing/library';
import { getScannerMissHint, isScannerMiss } from '../useVerifierController';

describe('verifier scanner decode errors', () => {
  it('treats transient ZXing decode exceptions as scanner misses', () => {
    expect(isScannerMiss(NotFoundException.getNotFoundInstance())).toBe(true);
    expect(isScannerMiss(FormatException.getFormatInstance())).toBe(true);
    expect(isScannerMiss(ChecksumException.getChecksumInstance())).toBe(true);
    expect(isScannerMiss('FormatException')).toBe(true);
  });

  it('uses a helpful hint when a QR-like image cannot be decoded yet', () => {
    expect(getScannerMissHint(FormatException.getFormatInstance())).toBe('QR detected but frame is incomplete or blurry. Center the full code.');
    expect(getScannerMissHint(NotFoundException.getNotFoundInstance())).toBe('QR code not detected yet. Move closer and keep focus.');
  });
});
