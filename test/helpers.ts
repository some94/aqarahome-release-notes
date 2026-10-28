import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import PostalMime from 'postal-mime';
import type { MailInput } from '../src/parser';

export const root = join(import.meta.dirname, '..');
export const sampleDir = join(root, 'fixtures', 'sample');
export const privateDir = join(root, 'fixtures', 'private');

export function sample(name: string): string {
  return readFileSync(join(sampleDir, name), 'utf8');
}

/** fixtures/private/*.eml이 있으면 true (실제 메일 테스트는 파일이 없으면 건너뜀) */
export const hasPrivateFixtures = existsSync(privateDir) && readdirSync(privateDir).some((f) => f.endsWith('.eml'));

export async function loadEml(name: string): Promise<MailInput> {
  const m = await PostalMime.parse(readFileSync(join(privateDir, name)));
  return { subject: m.subject ?? '', date: m.date ? new Date(m.date).toISOString() : undefined, html: m.html, text: m.text };
}

export function privateEmlExists(name: string): boolean {
  return existsSync(join(privateDir, name));
}
