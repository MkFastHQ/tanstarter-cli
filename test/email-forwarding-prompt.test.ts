import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../src/args.js';
import { createConfig } from '../src/config.js';
import { configureSetup } from '../src/prompt.js';

const { question, close } = vi.hoisted(() => ({
  question: vi.fn(), close: vi.fn(),
}));
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question, close }),
}));
const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
afterEach(() => {
  if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  question.mockReset();
  close.mockReset();
});

function setup(extra: string[] = []) {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const options = parseArgs(['create', 'demo', '--domain', 'example.com',
    '--email-sending', '--payment', 'none', '--repo', 'owner/demo', ...extra]);
  return { options, config: createConfig(options) };
}

describe('interactive catch-all forwarding', () => {
  it('asks for a verified destination, validates input, and displays domain scope', async () => {
    const { options, config } = setup();
    question.mockResolvedValueOnce('invalid').mockResolvedValueOnce('you@example.net')
      .mockResolvedValue('');
    const result = await configureSetup(options, config);
    expect(result.emailForwardTo).toBe('you@example.net');
    expect(question.mock.calls[0]?.[0]).toContain('*@example.com');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('*@example.com → you@example.net'));
    expect(close).toHaveBeenCalledOnce();
  });
  it('allows skipping without selecting a destination', async () => {
    const { options, config } = setup();
    question.mockResolvedValue('');
    expect((await configureSetup(options, config)).emailForwardTo).toBeUndefined();
  });
  it('does not ask again when the forwarding flag is supplied', async () => {
    const { options, config } = setup(['--email-forward-to', 'you@example.net']);
    question.mockResolvedValue('');
    expect((await configureSetup(options, config)).emailForwardTo).toBe('you@example.net');
    expect(question.mock.calls.some(([prompt]) => prompt.includes('which verified'))).toBe(false);
  });
  it.each([['--yes'], ['--resume']])('does not add prompts with %s', async (flag) => {
    const { options, config } = setup([flag]);
    await configureSetup(options, config);
    expect(question).not.toHaveBeenCalled();
  });
});
