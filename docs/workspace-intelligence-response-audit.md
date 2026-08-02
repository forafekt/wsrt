# Workspace intelligence response quality audit

This audit records the public-response issues observed in the real ActiveLane
acceptance output before the response-quality refinement.

## Node description semantics

`workspace node <id>` returns facts owned by that node. `--aggregate` additionally returns
bounded composed children as existing node descriptions, plus their composition relationships.
Aggregated file facts keep their original `ownerId`; the root node is never substituted as owner.
The default aggregate depth is one and the maximum is 32.

`contributionSources` is the sorted set of configuration/plugin contributions that supplied
facts merged into an association. It does not replace provenance: the association's evidence
records retain the exact source, file, schema path, and reason for each fact.

## Measured baseline

| Response | JSON bytes |
| --- | ---: |
| Node description | 3,381 |
| Aggregated application files | 11,489 |
| Reverse owners | 1,932 |
| Change impact | 49,203 |
| Validation recommendations | 9,057 |
| Command plan | 1,584 |

Validation returned 52 inline evidence records but only 13 unique records. The
captured responses contained 31 occurrences of malformed `processs.*`
configuration provenance.

## Findings and decisions

1. **Impact classification is a semantic bug.** Direct ownership, composite
   parents, runtime dependants, validation tasks, produced artifacts, and weakly
   related graph nodes are currently flattened into `affectedNodes`. Reachability
   is not sufficient evidence of material impact. The response will classify
   every compact entity reference and preserve traversal reasons.
2. **Broad artifacts need more precise classification.** A desktop configuration
   reaches `task:build`, which declares both desktop and workspace-wide outputs.
   Precise desktop outputs are produced artifacts; unrelated broad package output
   is related to the same producer but is not materially affected by the desktop
   change and must be labelled `related`, not affected.
3. **Embedded descriptions are a payload-design problem.** The 49 KB impact
   response embeds complete node descriptions. Compact classified references
   will become the default; existing descriptions remain available through an
   explicit expansion option.
4. **Repeated evidence is a payload-design bug.** Validation copies the same 13
   facts into every recommendation. Response-local deterministic evidence IDs
   will deduplicate records, and each recommendation will reference only its
   matching input or dependency edge.
5. **Node direct/aggregate behavior is intentional but undiscoverable.** Direct
   node description and aggregated file query are both valid, but the API does
   not state the distinction. Node description will gain explicit bounded
   aggregation using the existing ownership aggregation path.
6. **`processs.*` is a provenance-generation bug.** Configuration source paths
   are assembled with an invalid plural. Canonical schema paths will be generated
   at normalization time and covered by public-contract tests.
7. **Singular `contributionSource` is misleading after merging.** Associations
   can combine configuration and plugin evidence. It will be replaced by a
   deterministic `contributionSources` collection while preserving evidence.
8. **Command-plan fields conflate logical and executable concepts.** The logical
   application appears in `dependencyOrder` and `affectedProcesses`. Plans will
   distinguish requested targets, expanded executable targets, actions,
   executable order, affected logical nodes, and process-only entities.
9. **Revision zero is not itself a bug.** It denotes the initial control-plane
   snapshot. The missing piece is a documented and tested contract covering
   meaningful mutation, stale requests, concurrent clients, index invalidation,
   and restart behavior.
10. **Canonical ID discovery is insufficient.** Canonical process IDs are present
    deep inside workspace descriptions, leading consumers to guess aliases.
    Concise node listings, composition, deterministic alias resolution, and
    structured suggestions will make IDs discoverable without ambiguity.
11. **Onboarding is absent.** Consumers currently invent a first-call workflow.
    A vendor-neutral structured get-started operation should derive suggested
    calls and canonical IDs from the authoritative workspace.
12. **Human output is an ergonomics gap.** Protocol JSON is complete but the CLI
    lacks compact domain views. Formatting will consume classified domain data;
    it will not implement categorization or filtering locally.

These refinements preserve normalized configuration, the authoritative graph,
the revision-owned association index, the session protocol, and adapter
boundaries. They do not introduce another ownership or impact subsystem.
