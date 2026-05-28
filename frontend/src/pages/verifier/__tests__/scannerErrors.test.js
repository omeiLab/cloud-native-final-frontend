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
    expect(getScannerMissHint(FormatException.getFormatInstance())).toBe('偵測到 QR 但畫面不完整或模糊，請對準完整 QR');
    expect(getScannerMissHint(NotFoundException.getNotFoundInstance())).toBe('尚未辨識到 QR，請靠近並保持對焦');
  });
});
