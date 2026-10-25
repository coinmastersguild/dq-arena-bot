// These are strategy preferences; spell legality and lifecycle gates remain code-owned.
export const POLICY_LIMITS = Object.freeze({
  preferredRange: [22, 29, 2], retreatRange: [8, 16, 2], shieldHealth: [0.5, 0.9, 0.1],
  healerPriority: [20, 60, 10], tankPenalty: [40, 90, 10],
  finishHealth: [80, 160, 20], focusStickiness: [6, 20, 4],
  focusWindowSeconds: [6, 12, 2], losBackoffSeconds: [4, 10, 2],
});
export const DEFAULT_POLICY = Object.freeze({preferredRange: 27, retreatRange: 12, shieldHealth: 0.7,
  healerPriority: 40, tankPenalty: 60, finishHealth: 120, focusStickiness: 12,
  focusWindowSeconds: 8, losBackoffSeconds: 8});

export function validatePolicy(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).length !== Object.keys(POLICY_LIMITS).length) throw new Error('Invalid policy shape');
  for (const [key, [min, max]] of Object.entries(POLICY_LIMITS)) {
    if (!Object.hasOwn(value, key) || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) {
      throw new Error('Policy value outside allowed bounds');
    }
  }
  if (value.retreatRange + 6 > value.preferredRange) throw new Error('Insufficient casting band');
  return Object.freeze({...value});
}

export function validateProposal(value, current) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'changes,rationale' || typeof value.rationale !== 'string' ||
      value.rationale.length > 1200 || !value.changes || typeof value.changes !== 'object' || Array.isArray(value.changes)) {
    throw new Error('Invalid proposal shape');
  }
  const changes = Object.entries(value.changes);
  if (changes.length > 2) throw new Error('At most two changes per round');
  for (const [key, number] of changes) {
    if (!Object.hasOwn(POLICY_LIMITS, key) || !Number.isFinite(number) ||
        Math.abs(number - current[key]) > POLICY_LIMITS[key][2] + 1e-9) throw new Error('Invalid policy step');
  }
  return validatePolicy({...current, ...value.changes});
}

// Allowlist telemetry sent to inference. Names, chat, wallet/session data and raw events never enter it.
export function summarizeRound(result, name, policyId) {
  const me = result.players?.find(p => p.name === name && p.human);
  if (!me || !['freehold', 'coinfall'].includes(me.side)) return null;
  const number = n => Number.isFinite(n) && n >= 0 ? Math.min(n, 1e7) : 0;
  const m = me.metrics || {};
  const errors = m.errors || {};
  return {policyId, win: result.winner === me.side, durationS: number(result.diagnostics?.durationS),
    damage: number(me.damage), kills: number(me.kills), deaths: number(me.deaths),
    aliveS: number(m.aliveS), movingS: number(m.movingS), castingS: number(m.castingS),
    damageTaken: number(m.damageTaken), healingReceived: number(m.healingReceived),
    castCompletions: number(m.castCompletions),
    losErrors: number(errors['Line of sight.']), rangeErrors: number(errors['Out of range.']),
    noTargetErrors: number(errors['You have no target.']),
    allies: result.players.filter(p => p.side === me.side).length,
    enemies: result.players.filter(p => p.side !== me.side).length};
}
