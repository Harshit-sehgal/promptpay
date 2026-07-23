import { describe, expect, it, vi } from 'vitest';

import { Logger } from './logger';

describe('Logger', () => {
  it('logs errors to console.error in development', () => {
    const logger = new Logger('test');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('something went wrong', { detail: 'boom' });

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR] test: something went wrong'),
    );
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('"detail":"boom"'));
    consoleError.mockRestore();
  });

  it('logs warnings to console.warn in development', () => {
    const logger = new Logger('test');
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logger.warn('be careful', { count: 3 });

    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('[WARN] test: be careful'));
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('"count":3'));
    consoleWarn.mockRestore();
  });

  it('logs info to console.log in development', () => {
    const logger = new Logger('test');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('hello');

    expect(consoleLog).toHaveBeenCalledWith('[INFO] test: hello');
    consoleLog.mockRestore();
  });

  it('logs debug to console.log in development', () => {
    const logger = new Logger('test');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.debug('hello', { detail: 'world' });

    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] test: hello'));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('"detail":"world"'));
    consoleLog.mockRestore();
  });

  it('fromError logs the message and stack in development', () => {
    const logger = new Logger('test');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = new Error('boom');
    logger.fromError('handler failed', err);

    const output = consoleError.mock.calls[0][0] as string;
    expect(output).toContain('handler failed');
    expect(output).toContain('"error":"boom"');
    expect(output).toContain('"stack"');
    consoleError.mockRestore();
  });

  it('emits JSON in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const logger = new Logger('test');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('hello', { foo: 'bar' });

    const output = consoleLog.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({
      level: 'info',
      service: 'test',
      message: 'hello',
      context: { foo: 'bar' },
    });

    vi.unstubAllEnvs();
    consoleLog.mockRestore();
  });

  it('emits JSON to console.error in production for errors', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const logger = new Logger('test');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('bad', { code: 500 });

    const output = consoleError.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({
      level: 'error',
      service: 'test',
      message: 'bad',
      context: { code: 500 },
    });

    vi.unstubAllEnvs();
    consoleError.mockRestore();
  });

  it('fromError emits JSON with stack in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const logger = new Logger('test');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = new Error('boom');
    logger.fromError('handler failed', err);

    const parsed = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({
      level: 'error',
      service: 'test',
      message: 'handler failed',
      context: { error: 'boom' },
    });
    expect(parsed.context.stack).toContain('Error: boom');

    vi.unstubAllEnvs();
    consoleError.mockRestore();
  });
});
