#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { BuildError, buildSite, importAlbum, loadProject } from './index';

const USAGE = `Vernissage — static 3D gallery generator

  vernissage build <project-dir> --out <dir> [--base /path/] [--force]
  vernissage validate <project-dir>
  vernissage serve <site-dir> [--port 8080]
  vernissage import-album <google-photos-link> <new-project-dir>
`;

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function printIssues(issues: { path: string; message: string; severity: string }[]) {
  for (const i of issues) console.log(`  ${i.severity === 'error' ? '✗' : '!'} ${i.path ? i.path + ': ' : ''}${i.message}`);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export function serve(dir: string, port: number) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let p = normalize(join(root, url));
    if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(p).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    createReadStream(p).pipe(res);
  });
  server.listen(port, '127.0.0.1', () => console.log(`Serving ${root} at http://127.0.0.1:${port}/`));
  return server;
}

async function main(argv: string[]) {
  const [cmd, target, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help' || !target) { console.log(USAGE); return cmd ? 0 : 1; }
  try {
    if (cmd === 'validate') {
      const { issues } = await loadProject(target);
      console.log(issues.length ? 'Valid, with warnings:' : 'Valid.');
      printIssues(issues);
      return 0;
    }
    if (cmd === 'build') {
      const out = arg(rest, '--out');
      if (!out) { console.error('--out <dir> is required'); return 1; }
      let last = '';
      const report = await buildSite(target, out, {
        basePath: arg(rest, '--base'),
        force: rest.includes('--force'),
        onProgress: (step, d, t) => {
          const line = t > 1 ? `${step} ${d}/${t}` : step;
          if (process.stdout.isTTY) process.stdout.write(`\r\x1b[K${line}`);
          else if (step !== last) console.log(step);
          last = step;
        },
      });
      if (process.stdout.isTTY) process.stdout.write('\n');
      console.log(`Built ${report.artworks} works in ${report.rooms} rooms → ${report.outDir}`);
      console.log(`  ${report.processed} images processed, ${report.cached} from cache, ${(report.bytes / 1e6).toFixed(1)} MB, ${(report.durationMs / 1000).toFixed(1)} s`);
      if (report.issues.length) { console.log('Warnings:'); printIssues(report.issues); }
      return 0;
    }
    if (cmd === 'import-album') {
      const dir = rest[0] ? resolve(rest[0]) : undefined;
      if (!dir) { console.log(USAGE); return 1; }
      if (existsSync(dir) && readdirSync(dir).length) { console.error(`${dir} is not empty. Choose a new or empty folder for the project.`); return 1; }
      const r = await importAlbum(target, dir, { onProgress: (step, done, total) => process.stdout.write(`\r${step} ${done}/${total}   `) });
      console.log(`\nImported ${r.gallery.artworks?.length} photos from “${r.album.title}” into ${r.gallery.rooms.length} room${r.gallery.rooms.length === 1 ? '' : 's'} → ${dir}`);
      for (const m of r.skipped) console.log(`  ! ${m}`);
      return 0;
    }
    if (cmd === 'serve') { serve(target, Number(arg(rest, '--port') ?? 8080)); return -1; }
    console.log(USAGE);
    return 1;
  } catch (e) {
    if (e instanceof BuildError) { console.error(`Error: ${e.message}`); printIssues(e.issues); return 1; }
    throw e;
  }
}

main(process.argv.slice(2)).then((code) => { if (code >= 0) process.exitCode = code; });
