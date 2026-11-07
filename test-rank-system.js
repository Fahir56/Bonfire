const test = require('node:test');
const assert = require('node:assert/strict');
const { RANKS, normalizeRank, isShiftAdminAccount } = require('./rank-system');

test('all manual rank choices are explicitly allowed', () => {
  assert.deepEqual(RANKS,['F','D','B','A','T']);
  RANKS.forEach(x=>assert.equal(normalizeRank(x),x));
});
test('removing a rank is supported and arbitrary input rejected', () => {
  assert.equal(normalizeRank(null),null);
  assert.equal(normalizeRank(''),null);
  assert.equal(normalizeRank('NONE'),null);
  for (const x of ['S','X','admin','f','<script>',{},0,[],false]) assert.equal(normalizeRank(x),undefined);
});
test('Shift role requires *both* the configured account ID and exact account username', () => {
  const id='10000000-0000-4000-8000-000000000001';
  assert.equal(isShiftAdminAccount({id,username:'shift'},id),true);
  assert.equal(isShiftAdminAccount({id,username:'shift'},'20000000-0000-4000-8000-000000000002'),false);
  assert.equal(isShiftAdminAccount({id,username:'notshift'},id),false);
  assert.equal(isShiftAdminAccount({id,username:'shift'},null),false);
  assert.equal(isShiftAdminAccount(null,id),false);
});
