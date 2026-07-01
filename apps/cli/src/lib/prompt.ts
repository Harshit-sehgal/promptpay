import * as readline from 'readline';

export async function prompt(question: string, options: { silent?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: options.silent ? ({} as any) : process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
