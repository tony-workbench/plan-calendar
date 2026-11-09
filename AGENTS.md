# Working rules

- Read `docs/PRODUCT-DIRECTION.md` before picking work. Take queue items in order.
- English only in code, comments, docs and the interface.
- Run browser checks headless in a temporary browser context. Do not open visible windows or use a personal browser profile.
- Offline tests run with `node --test` and must pass without any API key or network.
- Never commit keys, tokens, personal data or absolute local paths. API keys live only in environment variables (the Gemini key is `GEMINI_API_KEY`); never write one into a file, a log, a test fixture, a prompt, a record or a commit message, and never print one. `tests/no-secrets.test.mjs` fails the build if a key pattern, a personal email or a local path appears in the tree.
- Commit messages are one sentence saying what changed.
