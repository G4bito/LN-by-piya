import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');

test('Storage rules keep portfolio writes Admin-only and reads public', () => {
  assert.match(rules, /match \/portfolio\/\{allPaths=\*\*\}/);
  assert.match(rules, /allow create, update: if isAdmin\(\) && isValidPortfolioImage\(\)/);
  assert.match(rules, /request\.auth\.token\.admin == true/);
  assert.doesNotMatch(rules, /allow (?:write|create, update): if true/);
});

test('Storage rules enforce exact image MIME types and upload limits', () => {
  assert.match(rules, /image\/\(jpeg\|png\|webp\)/);
  assert.doesNotMatch(rules, /jpeg\|jpg/);
  assert.match(rules, /request\.resource\.size <= 8 \* 1024 \* 1024/);
  assert.match(rules, /request\.resource\.size <= 5 \* 1024 \* 1024/);
});

test('booking references are private and scoped to the authenticated customer UID', () => {
  assert.match(rules, /match \/booking-references\/\{userId\}\/\{allPaths=\*\*\}/);
  assert.match(rules, /request\.auth\.uid == userId\s*&& isValidReferenceImage\(\)/);
  assert.match(rules, /request\.auth\.uid == userId \|\| isAdmin\(\)/);
});
