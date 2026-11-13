import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permitted, csv } from '../server/referrals/policy.js';

test('owner can request review but only eligible human reviewers can approve', () => {
  assert.ok(permitted({ status: 'recommended', next: 'pending_review', owner: true }));
  assert.equal(permitted({ status: 'pending_review', next: 'approved', manager: true, owner: true, independent: true }), false);
  assert.equal(permitted({ status: 'pending_review', next: 'approved', manager: false }), false);
  assert.ok(permitted({ status: 'pending_review', next: 'approved', manager: true, independent: true }));
  assert.ok(permitted({ status: 'pending_review', next: 'rejected', manager: true }));
  assert.equal(permitted({ status: 'pending_review', next: 'submitted', manager: true }), false);
  assert.ok(permitted({ status: 'approved', next: 'submitted', manager: true }));
  assert.ok(permitted({ status: 'submitted', next: 'completed', manager: true }));
  assert.equal(permitted({ status: 'completed', next: 'approved', manager: true }), false);
});

test('CSV escapes cells and neutralizes spreadsheet formulas', () => {
  assert.equal(csv([['=1+1', 'a"b', 'normal']]), '"\'=1+1","a""b","normal"');
});
