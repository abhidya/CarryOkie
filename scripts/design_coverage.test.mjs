import assert from 'node:assert/strict';
import fs from 'node:fs';
const coverage = JSON.parse(fs.readFileSync('design-coverage.json', 'utf8'));
assert.equal(coverage.criteria.length, 22);
assert.equal(coverage.summary.total, 22);
for (let i = 1; i <= 22; i++) assert.equal(coverage.criteria[i - 1].id, i);
for (const item of coverage.criteria) {
  assert.ok(['automated_full','automated_partial','manual_hardware_required'].includes(item.level), `bad level ${item.id}`);
  assert.ok(item.evidence?.length > 0, `missing evidence ${item.id}`);
  assert.notEqual(item.level, 'not_started', `not started ${item.id}`);
}
const full = coverage.criteria.filter(c => c.level === 'automated_full').length;
const partial = coverage.criteria.filter(c => c.level === 'automated_partial').length;
const manual = coverage.criteria.filter(c => c.level === 'manual_hardware_required').length;
assert.equal(full, coverage.summary.automated_full);
assert.equal(partial, coverage.summary.automated_partial);
assert.equal(manual, coverage.summary.manual_hardware_required);
assert.ok(full >= 10, `expected at least 10 full automated criteria, got ${full}`);
assert.ok(full + partial >= 19, `expected at least 19 criteria with automated evidence, got ${full + partial}`);
console.log(`PASS design.md coverage map: ${full} full, ${partial} partial, ${manual} hardware/manual`);
