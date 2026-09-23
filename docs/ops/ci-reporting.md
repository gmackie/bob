# CI result publication and recovery

The serial source-check job has a 30-minute budget. Native run 1166 used its
entire former 20-minute budget despite passing types, lint, tests, and the
deployable gate. Check concurrency remains unchanged.

The checking job saves `ci-report/report.json` and uploads the artifact
`ci-report-<native-run-id>-<attempt>` for 14 days. It contains source identity,
native outcomes and the check-event summary, without the reporting credential.
`Publish CI report` runs separately with a five-minute budget after both the
main job and research checks finish. It needs only Node, not a dependency
install. The publisher fails visibly on rejected, unavailable, or malformed
acknowledgements. This cannot change the deployable gate's decision.

The publisher verifies repository, source SHA, native run ID, visible run
number, and attempt against its context before sending. A failed, cancelled,
skipped, or unknown prerequisite cannot produce a successful workflow report.
Transport retries preserve the exact request body and never follow redirects.

## Replay a preserved result

Download the artifact from the original native run in Forgejo. Use the report
command from that run's exact source revision. Confirm the native main and
research job outcomes first; do not infer success from a partial log or a
green deployable gate. Preserve the native run's original conclusion.

Set these values from that run (the run ID and visible run number differ):

```sh
export CI_CHECK_SHA='<full-source-sha>'
export CI_CHECK_RUN_ID='<native-run-id>'
export CI_CHECK_ATTEMPT='<attempt>'
export GITHUB_REPOSITORY='gmackie/bob'
export GITHUB_SERVER_URL='https://git.forgegraf.com'
export GITHUB_RUN_NUMBER='<visible-run-number>'
export CI_SOURCE_RESULT='<success|failure|cancelled|skipped>'
export CI_RESEARCH_RESULT='<success|failure|cancelled|skipped>'
export CI_REPORT_BRANCH='<original-branch>'
# Load FG_CI_TOKEN from the approved secret store without printing it.
node scripts/ci-report.mjs send /path/to/downloaded/report.json
```

A missing artifact after a hard timeout produces a failure report from the
native run identity (or cancellation when a prerequisite was cancelled),
without fabricated check counts. Even successful native outcomes cannot turn
a missing artifact into success. Invalid or mismatched artifacts are rejected.
Replaying a report does not rerun tests or change the original native
job status. Keep the returned build ID with the recovery evidence.

Forgejo's artifact protocol is supported by the v3 upload/download actions
used here: https://forgejo.org/docs/v15.0/user/actions/advanced-features/#artifacts
