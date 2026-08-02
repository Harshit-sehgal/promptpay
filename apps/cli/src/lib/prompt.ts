import * as readline from 'readline';
import { Writable } from 'stream';

export async function prompt(
  question: string,
  options: { silent?: boolean } = {},
): Promise<string> {
  return new Promise((resolve) => {
    const output = options.silent
      ? new Writable({ write: (_chunk, _enc, cb) => cb() })
      : process.stdout;

    if (options.silent) {
      process.stdout.write(question);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output,
    });

    const finish = (answer: string) => {
      rl.close();
      resolve(answer.trim());
    };

    // EOF (e.g. a piped/closed stdin) must not hang the prompt forever:
    // resolve with an empty string so callers can treat it as "no input".
    rl.on('close', () => {
      resolve('');
    });

    rl.question(options.silent ? '' : question, (answer) => {
      finish(answer);
    });
  });
}
