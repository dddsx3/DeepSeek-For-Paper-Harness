// Minimal JUnit reporter shim. The collect-tests.mjs script only checks for
// this file's existence; vitest 4's built-in junit reporter is selected by
// `vitest --reporter=junit` if/when we want real JUnit XML output. Until
// then this no-op file lets the collector run unchanged.
export default function JUnitReporter() {
  return {
    onInit() {},
    onTestRunResult() {},
    onTestFileResult() {},
  }
}
