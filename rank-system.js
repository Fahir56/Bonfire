// Rank identity/validation is centralised so UI payloads never define privileges or CSS.
const RANKS = Object.freeze(['F','D','B','A','T']);
function normalizeRank(value) {
  if (value === null || value === '' || value === 'NONE') return null;
  if (typeof value !== 'string' || !RANKS.includes(value)) return undefined;
  return value;
}
function isShiftAdminAccount(account, configuredId) {
  return Boolean(account && configuredId && account.id === configuredId && account.username === 'shift');
}
module.exports = { RANKS, normalizeRank, isShiftAdminAccount };
