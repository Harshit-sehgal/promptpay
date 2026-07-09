import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
  getRequiredConsentVersions: vi.fn(),
  getCredentials: vi.fn(),
  setCredentials: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock('../lib/api-client', () => ({
  ApiClient: vi.fn(() => ({
    login: mocks.login,
    signup: mocks.signup,
    getRequiredConsentVersions: mocks.getRequiredConsentVersions,
  })),
}));

vi.mock('../lib/credentials', () => ({
  getCredentials: mocks.getCredentials,
  setCredentials: mocks.setCredentials,
}));

vi.mock('../lib/prompt', () => ({
  prompt: mocks.prompt,
}));

import { runAuth } from './auth';

const loginResult = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'user_123', role: 'developer' },
};

describe('runAuth login', () => {
  let exitSpy: { mockRestore: () => void };
  let logSpy: { mockRestore: () => void };
  let errorSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentials.mockReturnValue(null);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit:${code ?? ''}`);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('logs in with email and password only when 2FA is not required', async () => {
    mocks.prompt.mockResolvedValueOnce('password-1');
    mocks.login.mockResolvedValueOnce(loginResult);

    await runAuth({ email: 'dev@example.com' });

    expect(mocks.prompt).toHaveBeenCalledWith('Password:', { silent: true });
    expect(mocks.login).toHaveBeenCalledWith({
      email: 'dev@example.com',
      password: 'password-1',
    });
    expect(mocks.setCredentials).toHaveBeenCalledWith({
      email: 'dev@example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      userId: 'user_123',
      role: 'developer',
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prompts for a 2FA code and retries login when the API returns a 2FA challenge', async () => {
    mocks.prompt
      .mockResolvedValueOnce('password-1')
      .mockResolvedValueOnce('123456');
    mocks.login
      .mockRejectedValueOnce({
        status: 401,
        message: 'Two-factor authentication code required',
        twoFactorRequired: true,
      })
      .mockResolvedValueOnce(loginResult);

    await runAuth({ email: 'dev@example.com' });

    expect(mocks.prompt).toHaveBeenNthCalledWith(1, 'Password:', { silent: true });
    expect(mocks.prompt).toHaveBeenNthCalledWith(2, 'Two-factor code:', { silent: true });
    expect(mocks.login).toHaveBeenNthCalledWith(1, {
      email: 'dev@example.com',
      password: 'password-1',
    });
    expect(mocks.login).toHaveBeenNthCalledWith(2, {
      email: 'dev@example.com',
      password: 'password-1',
      twoFactorToken: '123456',
    });
    expect(mocks.setCredentials).toHaveBeenCalledWith({
      email: 'dev@example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      userId: 'user_123',
      role: 'developer',
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not persist credentials when the 2FA challenge is cancelled', async () => {
    mocks.prompt
      .mockResolvedValueOnce('password-1')
      .mockResolvedValueOnce('');
    mocks.login.mockRejectedValueOnce({
      status: 401,
      message: 'Two-factor authentication code required',
      twoFactorRequired: true,
    });

    await expect(runAuth({ email: 'dev@example.com' })).rejects.toThrow('process.exit:1');

    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.setCredentials).not.toHaveBeenCalled();
  });
});

describe('runAuth signup consent versions', () => {
  let exitSpy: { mockRestore: () => void };
  let logSpy: { mockRestore: () => void };
  let errorSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentials.mockReturnValue(null);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit:${code ?? ''}`);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('does not create an account when current consent versions cannot be loaded', async () => {
    mocks.prompt
      .mockResolvedValueOnce('CLI User')
      .mockResolvedValueOnce('password-1')
      .mockResolvedValueOnce('password-1')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('y')
      .mockResolvedValueOnce('y');
    mocks.getRequiredConsentVersions.mockRejectedValueOnce(new Error('network down'));

    await expect(runAuth({ email: 'dev@example.com', signup: true })).rejects.toThrow(
      'process.exit:1',
    );

    expect(mocks.signup).not.toHaveBeenCalled();
    expect(mocks.setCredentials).not.toHaveBeenCalled();
  });
});
