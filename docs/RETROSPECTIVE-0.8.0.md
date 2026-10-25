# v0.8.0 review: survival, pursuit and NPC stalls

Reviewed October 25, 2026, after the operator reported failure to finish surviving
enemies and characters apparently stuck on paths. Local recordings are private;
the descriptions below contain gameplay observations only.

## What the recordings establish

In the latest 20 completed recordings containing FrostByteAgent at the start of
this review (15:24–18:39 UTC), our mage had a recorded death in 19 and zero timed
cast completions in 18. One recording included a departure before the end, so this
is a diagnostic sample, not a controlled win-rate comparison. The policy in use
was p0007. GLM had reached its configured 12-request daily cap; the runner kept
playing with the existing policy. Parameter tuning cannot repair a control-flow bug.

The 18:28 UTC recording shows the failure clearly:

- At simulation tick 541, a LOS error changed focus from a DPS enemy to a healer.
- The mage continued toward that healer despite another enemy approaching melee.
- At tick 677 it requested Frostbolt. The server reported a cast start at tick 681,
  initially ending at tick 724. Incoming damage pushed the end to tick 744 and then
  tick 794. Health fell from 471 at tick 681 to 51 at tick 721.
- The controller's unconditional cast wait issued no defensive movement. Death
  arrived at tick 729, before the delayed cast could complete.

Retreat was based on distance to the selected damage target, not distance to the
nearest threat. Pursuing a healer could therefore place the mage beside an enemy
tank without triggering retreat. The cast wait then prevented escape even as the
cast was repeatedly delayed. Team wins concealed this individual failure.

Target selection already switches away from a dead focus. A new regression test
checks that a living leader selects, approaches and sends a focus order for the
last survivor. The review did not establish a general failure of that selector.

## Separate server-side pursuit evidence

The 18:34 UTC match reached its 300-second timeout. Our mage died after 25.8 seconds.
At the final recorded fight tick, 6198:

| Actor | Side | Position (x, z) | Time without >=0.5-unit movement |
| --- | --- | --- | --- |
| Hunter, entity 141 | Freehold | 4494.97, -883.41 | 227.3 seconds |
| Tank, entity 131 | Coinfall | 4496.78, -943.34 | 207.0 seconds |
| Mage NPC, entity 135 | Coinfall | 4494.40, -951.98 | 206.1 seconds |
| Hunter, entity 136 | Coinfall | 4496.58, -954.28 | 206.0 seconds |

The Freehold hunter still targeted enemy 131. Enemy NPCs retained targets, including
one dead actor. The four actors above produced no observed positive damage for more
than 220 seconds each. This establishes stalled combat and pursuit, but does not
identify whether collision, leash/return behavior, stale goals or target validation
caused it. Stationary ranged casting alone would not establish a pathing failure.

A second timeout at 14:12 UTC shows an enemy hunter around (4481.17, -888.93) stationary
for 222.1 seconds while surviving allied NPCs remained near z=-943 to -977 for roughly
181–190 seconds. This is another useful reproduction, not proof of the same cause.

The [native API contract](https://degenquest.ai/docs) permits coaching only by a
living team leader. A dead mage cannot move NPCs or issue legal pursuit orders;
the bot repository cannot fix their server-owned navigator. No spectator controls,
opponent files, operator diagnostics or server modifications were used in this review.

Server investigation handoff:

1. Reproduce the two spatial configurations above with surviving opponents and a
   dead leader, including a ranged fighter outside its attack range.
2. Inspect target validity, current navigation goal, blocked displacement, leash
   state, LOS and the reason for each early return from the NPC decision loop.
3. Check that leader death and target death invalidate old focus/move goals, and
   that living NPCs can choose and pursue another hostile without a human command.
4. Add a bounded repath trigger for stationary pursuit and a test where an enemy
   survivor moves beyond range. Preserve healing/CC/casting pauses as valid inactivity.

## v0.9.0 controller changes

- Separate defensive movement from the damage target. Retreat from nearby enemies
  with hysteresis, and from a current attacker under low health or prolonged casting.
- Evaluate survival movement before the cast wait. Send ordinary movement intent
  while threatened; wait for subsequent snapshots before attempting another spell.
  No undocumented cancel-cast command or unverified Blink navigation is used.
- After four failed navigation escapes, pause for five seconds and retry with a
  changed direction. Also detect movement that makes no approach progress against
  a stable goal. This replaces permanent abandonment for the rest of the match.
- Cap LOS retry backoff at eight seconds when only one or two enemies remain.
  Repositioning requirements and normal spell legality gates remain active.

Validation: 60 offline tests pass, including pressure during casting, retreat away
from an off-target attacker, rooted/safe casts, last-survivor selection, navigation
retry and circling without progress. Open-loop replay of the 18:28 UTC recording
issues defensive movement at tick 681, where v0.8.0 stayed casting. Replay does not
change recorded positions or outcomes and cannot demonstrate a live survival gain.
The NPC server-side stall remains unresolved by this controller release.
