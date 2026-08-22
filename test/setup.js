// Keep the log lines the bridge now emits out of the test output. The logger
// reads LOG_LEVEL on every call, so tests that assert on logging raise it
// themselves.
process.env.LOG_LEVEL = "silent";
