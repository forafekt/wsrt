# ActiveLane workspace-intelligence usefulness evaluation

The same desktop Vite configuration investigation was repeated after the response refinement.

| Measure | Earlier sequence | Refined sequence |
| --- | ---: | ---: |
| WSRT calls in recommended workflow | 10 | 10 |
| Invalid-ID attempts | 3 | 0 |
| Filesystem reads needed for workspace discovery | 0 | 0 |
| Broad searches | 0 | 0 |
| Unresolved workspace-model questions | not recorded | 0 |
| Impact payload | 49,203 bytes | 4,193 bytes |
| Validation payload | 9,057 bytes | 1,762 bytes |
| Repeated evidence records | 39 | 0 |
| Calls needed to identify canonical process IDs | not achieved by guessing | 1 node-list query |

Impact is 91.5% smaller and validation is 80.5% smaller. The refined ten-call workflow uses the
same call budget to cover discovery, architecture, aggregate node facts, ownership, graph scope,
planning, impact, validation, and diagnostics rather than spending three calls on invalid guesses.

The evaluation answers are affirmative:

1. A zero-knowledge consumer discovers canonical IDs before targeted calls.
2. Compact impact entities explain relationship categories without embedded node snapshots.
3. Each validation task has one directly relevant evidence reference and an explicit prerequisite.
4. Plans distinguish the requested application from executable actions and process-only impact.
5. The revision contract explains initial zero, mutations, stale reads, caches, and restart scope.
6. Both default analytical payloads are materially smaller.
7. The non-JSON CLI exposes readable aggregate nodes, owners/files, categorized impact, validation
   flow, and execution plans with revision metadata.

Human readability was checked in a narrow line-oriented terminal view. Agent readability was
checked through stable field names, classified compact entities, evidence references, canonical
suggestions, and exact adapter-parity comparisons. No filesystem read or broad search was required
to answer a workspace-model question; reading source remains necessary only for implementation
details outside WSRT's declared authority.
