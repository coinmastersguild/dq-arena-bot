/** Tournament accounting. The operator/agent does the actual improvement work. */
export function readyGate(tournament, status, now = Date.now()) {
  if (tournament.rounds.length >= tournament.roundLimit) return 'Tournament complete';
  if (tournament.activeRun) return 'A round is already active';
  if (now < Date.parse(tournament.readyNotBefore)) return 'Improvement window is still open';
  if (!status.connected || status.state !== 'lobby' || status.spectator) return 'No active player lobby';
  if (now - Date.parse(status.updatedAt) > 10000 || !Number.isFinite(Date.parse(status.updatedAt))) return 'Lobby status is stale';
  if (status.name !== tournament.account || status.side !== tournament.side) return 'Wrong player or side';
  const opposing = Object.entries(status.lobby?.sides || {}).find(([side]) => side !== status.side)?.[1] || [];
  if (!opposing.some(s => s.human && s.name === tournament.opponent)) return 'Expected opponent is not seated';
  if (!status.runDirectory) return 'Runner does not identify its recording directory';
  return null;
}
export function finishRound(tournament, result, runDirectory, version, now = Date.now()) {
  if (tournament.activeRun !== runDirectory) throw new Error('Result is not from the active tournament run');
  if (result.state !== 'results' || !result.players || !result.diagnostics) throw new Error('Incomplete result');
  const self = result.players.find(p => p.name === tournament.account && p.human);
  const opponent = result.players.find(p => p.name === tournament.opponent && p.human);
  if (!self || !opponent || self.side === opponent.side) throw new Error('Expected opposing players missing from result');
  const rounds = [...tournament.rounds, {round: tournament.rounds.length + 1, version,
    outcome: result.winner === self.side ? 'win' : result.winner ? 'loss' : 'draw',
    winner: result.winner, durationS: result.diagnostics.durationS, runDirectory,
    damage: self.damage, opponentDamage: opponent.damage, deaths: self.deaths,
    castCompletions: self.metrics?.castCompletions, errors: self.metrics?.errors,
    completedAt: new Date(now).toISOString()}];
  return {...tournament, rounds, activeRun: null, nextRound: rounds.length + 1,
    status: rounds.length >= tournament.roundLimit ? 'complete' : 'improving',
    windowStartedAt: new Date(now).toISOString(), readyNotBefore: new Date(now + tournament.improvementSeconds * 1000).toISOString()};
}
