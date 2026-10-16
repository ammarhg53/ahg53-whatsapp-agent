// Copies assets/logo.png for the dashboard header, favicon and quote PDFs.
// (WhatsApp messages don't use it; the profile photo is set in Kapso.)
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';

const src = path.join(ROOT, 'assets', 'logo.png');
mkdirSync(path.join(ROOT, 'public'), { recursive: true });

if (existsSync(src)) {
  copyFileSync(src, path.join(ROOT, 'public', 'logo.png'));
  copyFileSync(src, path.join(ROOT, 'src', 'app', 'icon.png'));
  console.log('Logo: assets/logo.png → public/logo.png, src/app/icon.png');
} else {
  console.log('Logo: assets/logo.png not found — dashboard shows no logo.');
}
