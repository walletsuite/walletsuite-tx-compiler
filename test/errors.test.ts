import { describe, expect, it } from 'vitest';
import { TxCompilerError } from '../src/errors.js';

describe('TxCompilerError', () => {
  it('has the correct name', () => {
    const err = new TxCompilerError('INVALID_PAYLOAD', 'test');
    expect(err.name).toBe('TxCompilerError');
  });

  it('is an instance of Error', () => {
    const err = new TxCompilerError('INVALID_PAYLOAD', 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TxCompilerError);
  });

  it('stores code', () => {
    const err = new TxCompilerError('UNSUPPORTED_CHAIN', 'bad chain');
    expect(err.code).toBe('UNSUPPORTED_CHAIN');
  });

  it('stores message', () => {
    const err = new TxCompilerError('INVALID_PAYLOAD', 'something broke');
    expect(err.message).toBe('something broke');
  });

  it('stores optional details', () => {
    const details = { field: 'valueWei', value: -1 };
    const err = new TxCompilerError('INVALID_AMOUNT', 'bad amount', details);
    expect(err.details).toEqual(details);
  });

  it('has undefined details when not provided', () => {
    const err = new TxCompilerError('INVALID_PAYLOAD', 'test');
    expect(err.details).toBeUndefined();
  });

  it('produces a useful stack trace', () => {
    const err = new TxCompilerError('COMPILATION_FAILED', 'fail');
    expect(err.stack).toContain('TxCompilerError');
    expect(err.stack).toContain('fail');
  });

  it('works with try/catch instanceof check', () => {
    try {
      throw new TxCompilerError('INVALID_ADDRESS', 'bad addr');
    } catch (e) {
      expect(e).toBeInstanceOf(TxCompilerError);
      if (e instanceof TxCompilerError) {
        expect(e.code).toBe('INVALID_ADDRESS');
      }
    }
  });
});
