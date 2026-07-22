import { promises as fs } from 'fs';
import Link from 'next/link';
import path from 'path';

export default async function CookiePolicyPage() {
  let body = '';
  try {
    const file = path.join(process.cwd(), 'docs', 'legal', 'cookie-policy.md');
    body = await fs.readFile(file, 'utf8');
  } catch {
    body = '# Cookie Policy\n\nContent unavailable.';
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-brand-500 hover:text-brand-600 text-xs font-medium">
          ← Back
        </Link>
        <article className="prose-wl mt-4">
          <pre className="whitespace-pre-wrap text-surface-700 text-sm leading-relaxed font-sans">
            {body}
          </pre>
        </article>
      </div>
    </main>
  );
}
