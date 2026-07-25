# Release trust and supply chain

WSRT runs local configuration and dynamically loaded plugins as code with the user's full process permissions. Install and configure only trusted packages. Package plugins resolve relative to the consumer workspace; relative/file plugins are explicit local-code trust boundaries. No WSRT package adds a postinstall script or downloads an executable.

The Node runtime starts declared commands. Review configs before running lifecycle mutations. JSON CLI output disables WSRT ANSI rendering. Dashboard defaults must remain loopback-only; binding to `0.0.0.0` exposes its API and must be an explicit operator decision. MCP transports are consumer-supplied and mutations are disabled unless enabled explicitly.

The Rust native host is excluded from npm until platform artifacts and their licenses can be built and verified in CI. Release CI uses frozen dependencies, package allowlists, tarball inspection, npm provenance, and an approval environment. Dependabot/audit findings should be triaged before each release; an audit result is evidence, not an automatic breaking-change mandate.
