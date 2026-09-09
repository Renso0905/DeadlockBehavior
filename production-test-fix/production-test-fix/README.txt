DeadlockBehavior permanent-buff production test fixture fix

Run from PowerShell:
& "G:\Node\node.exe" ".\install-production-test-fix.mjs" "G:\DeadlockBehavior"

Then rerun:
& "G:\Node\node.exe" --test "G:\DeadlockBehavior\inspector-v04\tests\*.test.mjs"

Expected: 19 tests, 19 pass, 0 fail.
