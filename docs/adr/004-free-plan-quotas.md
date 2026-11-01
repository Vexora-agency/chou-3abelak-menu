# ADR-004: Free-plan quota decision

Stay on the free plan per client until sustained load (>500 orders/day or
view-heavy traffic): first breakage is KV writes (1k/day ≈ 800-900 orders),
not code. Upgrade trigger is per-client revenue/load, never client count
(one account per client removes the D1-count ceiling). Record the decision
date per client in the launch checklist.
