// Prints the release text for a version: how to install, then that version's entry from CHANGELOG.md.
// Usage: node scripts/release-notes.mjs 0.7.2
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const start = log.split('\n').findIndex((l) => l.startsWith(`## ${version}`));
if (!version || start < 0) { console.error(`No CHANGELOG.md entry for "${version}"`); process.exit(1); }
const lines = log.split('\n').slice(start + 1);
const end = lines.findIndex((l) => l.startsWith('## '));
const entry = (end < 0 ? lines : lines.slice(0, end)).join('\n').trim();

// each file name links straight to its download (the links work once the release is published)
const file = (name) => `[\`${name}\`](https://github.com/dirkprimbs/vernissage/releases/download/v${version}/${name})`;

console.log(`## Install

Click the file for your computer to download it.

| Your computer | Download | Then |
|---|---|---|
| **Windows** (10 or 11) | ${file(`vernissage-studio-${version}-windows-x64.exe`)} | Double-click it. Windows may say it protected your PC: choose *More info*, then *Run anyway*. |
| **Mac** with Apple chip (M1 or later) | ${file(`vernissage-studio-${version}-mac-arm64.dmg`)} | Open it and drag Vernissage Studio to Applications. The first time, macOS refuses to open it: go to *System Settings › Privacy & Security* and choose *Open Anyway*. |
| **Mac** with Intel chip | ${file(`vernissage-studio-${version}-mac-x64.dmg`)} | As above. |
| **Linux** | ${file(`vernissage-studio-${version}-linux-x86_64.AppImage`)} | Make it executable (\`chmod +x\`) and run it. On Debian and Ubuntu you can install the ${file(`vernissage-studio-${version}-linux-amd64.deb`)} instead. |

The warnings on Windows and macOS appear because these builds are not signed with a paid developer certificate.

## What's new

${entry}
`);
