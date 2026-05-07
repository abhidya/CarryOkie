import fs from 'node:fs';
import { execSync } from 'node:child_process';

console.log('Building with Vite...');

try {
  execSync('npx vite build', { stdio: 'inherit' });
  console.log('✓ Vite build completed');
} catch (error) {
  console.error('✗ Vite build failed:', error.message);
  process.exit(1);
}

// Verify required files exist in dist
const required = [
  'dist/index.html',
  'dist/host/index.html',
  'dist/player/index.html',
  'dist/receiver/index.html',
  'dist/debug/index.html',
];

const missing = required.filter(p => !fs.existsSync(p));
if (missing.length) {
  console.error('Missing required files in dist: ' + missing.join(', '));
  process.exit(1);
}


const htmlFiles = required.map(p => [p, fs.readFileSync(p, 'utf8')]);
const badHtmlRefs = htmlFiles.flatMap(([file, html]) => {
  const bad = [];
  if (/\b(?:src|href)=['"]\/(?:assets|src)\//.test(html)) bad.push('root-relative asset/source URL');
  if (/\b(?:src|href)=['"][^'"]*(?:main\.ts|styles\.css)/.test(html) && !/assets\//.test(html)) bad.push('unbundled source URL');
  return bad.map(reason => `${file}: ${reason}`);
});
if (badHtmlRefs.length) {
  console.error('Built HTML contains GitHub Pages-hostile references:\n' + badHtmlRefs.join('\n'));
  process.exit(1);
}

const builtJs = fs.readFileSync('dist/assets/main2.js', 'utf8');
const badPublicRefs = ['/public/protected', '/public/cast', '../public/songs'].filter(ref => builtJs.includes(ref));
if (badPublicRefs.length) {
  console.error('Built JS contains public-directory references that do not exist in dist: ' + badPublicRefs.join(', '));
  process.exit(1);
}

// Verify protected catalog exists
if (!fs.existsSync('public/protected/catalog.json')) {
  console.error('Missing public/protected/catalog.json - run npm run importMedia first');
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync('public/protected/catalog.json', 'utf8'));

// Verify Cast media exports exist
const missingCast = (catalog.songs || []).filter(song => {
  if (!song.defaultCastMediaUrl) return true;
  const castPath = song.defaultCastMediaUrl.replace(/^\//, '');
  return !fs.existsSync(castPath);
});

if (missingCast.length) {
  console.error('Missing Default Cast media exports for: ' + missingCast.map(s => s.songId).join(', '));
  console.error('Run: npm run exportCastMedia');
  process.exit(1);
}

console.log('✓ Static build OK: GitHub Pages can serve dist at /CarryOkie/ plus /host /player /receiver /debug');
console.log(`✓ Default Cast media exports: ${catalog.songs.length}`);
console.log('✓ Ready to deploy to GitHub Pages');

