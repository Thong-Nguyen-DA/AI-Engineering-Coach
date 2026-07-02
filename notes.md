# Additional Notes

## Files to modify

- analyzer-config ✅
- analyzer-insights ✅
- config-health-helpers ✅
- parser-harness ✅
- parser-shared ✅
- webview/page-config ✅
- webview/shared ✅

## Run test

```bash
npm run test
```

or

```bash
npx vitest
```

## Run lint (after every changes and tests)

```bash
npm run lint
```

## Rebuild after making changes

```bash
npm run build
```

or in dev

```bash
npm run watch
```

`watch` is better — it auto rebuilds when files change

```bash
bash update.sh
```

## Changes plan

- The app still misses a lot of existing sessions. Identify the problem and fix it. 🟡
    - Resolved nested tool_result.content array schema incompatibility ✅
- Use session-id.json metadata field for user prompt and token tracking. ✅
- Convert timestamp value of session-id.json started_at and ended_at to match the app format ✅
- Find out why the session ended_at are not recorded in the timeline. ✅
