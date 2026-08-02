# WSRT-first workspace workflow

The earlier ActiveLane sequence guessed three process IDs because discovery exposed a large node
set without a concise canonical-ID listing, and a direct application description did not surface
its children. Those guesses were a product-discovery failure, not a consumer syntax failure.

`workspace.get-started` now generates this sequence from the loaded workspace (the chosen main node
and investigation path are actual returned values):

1. `workspace.capabilities`
2. `workspace.describe`
3. `workspace.nodes.query`
4. `workspace.node.describe` for the main node with `aggregate: true`, depth 1
5. `workspace.files.query` for that node with aggregate ownership
6. `workspace.graph.query` in both directions, depth 2
7. `workspace.command.plan` for the logical lifecycle target
8. compact `workspace.change.impact` for a relevant declared file
9. `workspace.validation.recommend` for the same file
10. `diagnostics.get`

The node list prevents ID guessing. The bounded aggregate description makes separate calls for each
child process unnecessary while preserving their canonical IDs and original ownership. `workspace
describe` still shows composition, but the concise node list is the primary discovery surface.

Impact precedes validation because it explains ownership and relationship categories from which the
validation tasks follow; a separate reverse-owner call is optional because compact impact already
contains direct owner IDs. Diagnostics belongs in the first ten because configured architecture and
current operability are different questions. Runtime state is already present in node descriptions;
a separate broad runtime snapshot would duplicate it.

Only child descriptions are combined, through bounded aggregation. Architecture, file ownership,
graph traversal, impact, validation, planning, and diagnostics remain separate calls so consumers
can control payload size and evidence expansion.
