<!--
Thanks for the pull request. Keep it focused: unrelated changes are easier to
review as separate PRs. If this changes public behaviour and there is no issue
for it yet, please explain the reasoning below.
-->

## What changed

<!-- One or two sentences. Link the issue with "Fixes #123" if there is one. -->

## Why

<!-- The problem this solves, or the decision behind the change. -->

## How it was verified

<!-- Commands you ran, and what you checked manually. -->

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Behavioural changes were verified end to end with an example
      (`npm --prefix examples/blog run build`, `run start`, then
      `node examples/blog/smoke.mjs`)
- [ ] Exported functions have JSDoc for parameters and return types
- [ ] Comments explain *why*, not what the code does
- [ ] No application-specific knowledge was added under `src/`
- [ ] No directory was located by counting `../..`; `getConfig().dirs` was used
- [ ] A new public surface was added to `package.json` → `exports` and the
      matching barrel (`src/index.js` / `src/client/index.js`)
- [ ] Documentation under `docs/` was updated
- [ ] Examples were updated if a shared surface changed
- [ ] No build output (`public/assets/**`, `.jskelet/**`) is committed

## Breaking changes

<!-- Delete if none. Otherwise describe what an application has to change. -->
