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

console.log('✓ Static build OK: GitHub Pages can serve repo root plus /host /player /receiver /debug');
console.log(`✓ Default Cast media exports: ${catalog.songs.length}`);
console.log('✓ Ready to deploy to GitHub Pages');

