# Releasing WSRT

## Preconditions

- Confirm the project license and add a root `LICENSE` matching every manifest. This is intentionally unresolved and blocks publication.
- Confirm ownership of both the unscoped `wsrt` npm name and the `@wsrt` npm scope, and configure npm trusted publishing for `.github/workflows/release.yml`.
- Protect release tags and require review of the exact revision.
- Ensure the version does not already exist on npm.

## Local simulation

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm architecture:check
pnpm build
pnpm release:check
pnpm release:pack
pnpm external-consumer:test
git diff --check
```

Tarballs are reproducibly staged under ignored `.release/tarballs`. The packer generates each package's `LICENSE` from the canonical root file, validates README/license/entry-point contents, and restores the source tree. Inspect tarballs before publishing. The external fixture installs the `wsrt` distribution and every modular WSRT package via those exact tarballs, with no workspace links.

`Repository validation` runs read-only checks for pushes and pull requests with no publication credentials. `Release npm packages` runs the same validation, package inspection, external consumer smoke tests, and Rust tests; only its protected tag publication job receives OIDC permission. Prerelease versions use `next`; stable versions use `latest` only from an explicitly reviewed stable version tag and protected `npm` environment.

## First prerelease

After resolving the license blocker, synchronize the package set, commit, and tag the reviewed revision:

```bash
pnpm version:sync
WSRT_VERSION="$(node -p "require('./package.json').version")"
git tag "v${WSRT_VERSION}"
git push origin "v${WSRT_VERSION}"
```

Approve the GitHub `npm` environment. The tag workflow validates, packs, re-runs the consumer smoke test, and publishes with provenance under `next`. For an authorized local emergency publish only:

```bash
WSRT_RELEASE_CONFIRM="$(node -p "require('./package.json').version")" pnpm release:publish
```

Stable versions publish to `latest`; prereleases publish to `next`. Never republish a version. If a bad version escapes, publish a corrected version, deprecate the affected npm versions with an explanatory message, and revoke compromised credentials if applicable. npm unpublish should be reserved for policy/security cases.

Every release adds a current-version section to `CHANGELOG.md`; do not fabricate back history. Fixed versions keep all public packages synchronized even if some packages have no code changes.
