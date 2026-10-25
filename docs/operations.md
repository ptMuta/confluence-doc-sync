---
title: Operations guide
---

How to release, update and keep Docs sync running. Alerts and their signals are in the [monitoring catalog](monitoring.yaml).

![Release pipeline](diagrams/release.drawio 'Releases, nightlies and cleanup')

## Releases

Run the release workflow on main with a version such as v1.0.0, or v1.0.0-rc.1 for a release candidate. The release environment can require a reviewer. The workflow builds and scans the image, pushes it to GHCR with a provenance attestation, commits action.yml pinned to the image digest, and creates an immutable release from that commit, see [[DEC-0013]].

Verify a release:

```sh
gh release verify v1.0.0 -R ptMuta/confluence-doc-sync
gh attestation verify oci://ghcr.io/ptmuta/confluence-doc-sync@sha256:<digest> -R ptMuta/confluence-doc-sync
```

## Nightly and cleanup

The same workflow runs every night at 03:17 UTC. If main has changes beyond docs since the last nightly, it publishes nightly-YYYYMMDD in the nightly environment, which has no reviewers, and moves the nightly image tag and git tag. Run the workflow with version nightly to publish one by hand. A cleanup job then deletes older nightlies and release candidates whose final version exists, with their images. Final releases stay until deleted by hand.

## Dogfooding

This repository syncs its own docs to the Documentation folder in GCS. Pull requests check the docs with the action built from source. Pushes to main plan and publish with the latest nightly release, so the docs go out through the published action and image. It sets approval: none, so every change publishes through docs-sync-publish-low-risk without waiting.

## Dependency updates

Dependabot opens one pull request a week for npm, GitHub Actions and Docker, after a 7 day cooldown. For a security fix in the base image, move DEBIAN_SNAPSHOT in the Dockerfile forward. For a new draw.io version, change DRAWIO_VERSION and DRAWIO_SHA256 together and review the rendered samples from CI.

## Confluence credentials

Plan and publish use OAuth credentials of the service account, see [[DEC-0015]]. Each run exchanges them for an access token that lasts an hour. To rotate a credential:

1. Create a new OAuth credential for the service account with the scopes in the README.
2. Replace the client ID and secret in the environments that hold them.
3. Run the live-test workflow and check it passes.
4. Revoke the old credential.

## Ownership key

Keep DOCS_SYNC_OWNERSHIP_KEY the same in every publish environment. Rotation is not supported yet: after a key change, publish refuses every existing page as unsigned.

## Failed publish

| Message                                          | Cause                                                       | Fix                                                               |
| ------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Risky changes need the high-risk or manual tier  | New, moved or archived pages, or a manual edit to overwrite | Approve through the high-risk environment or the approve workflow |
| was edited in Confluence after the plan          | Someone edited a page between plan and publish              | Re-run the plan                                                   |
| has no valid ownership signature                 | The page was not created by this tool, or the key changed   | Check the key; move the page out from under the root              |
| The bundle does not match expected-bundle-sha256 | The bundle differs from the planned one                     | Start publish from the plan run's own outputs                     |
| Who can view the root changed since the plan     | Permissions changed between plan and publish                | Check the change, then plan again                                 |
| The token is missing these scopes                | The token lacks a scope                                     | Add the scopes named in the message                               |

## Live test

The live-test workflow runs plan and publish against the test site, including refusals and draw.io macros, then archives its test pages. Run it after changes to the Confluence client or the publish checks.
