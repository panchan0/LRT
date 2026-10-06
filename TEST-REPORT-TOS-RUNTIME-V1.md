# T-OS Runtime v1 Test Report

Build: Raven 0.17.9  
Date: 2026-10-05

Command executed:

```bash
node --test tests/tos-runtime-v1.test.js
```

Result:

```text
tests 11
pass 11
fail 0
cancelled 0
skipped 0
todo 0
```

The tests load `TOSHostBridge` and `TOSRuntime` directly from the shipped `index.html`, then execute them in a controlled VM with fake iframe/window boundaries. They do not reimplement the production classes.

The requested end-to-end test with `T-OS-Beta-v0.2.0-beta.2.tos` was not executed because that `.tos` file was not available in the task artifacts. This report intentionally does not mark that criterion as PASS.
