# Working rules

- Read `docs/PRODUCT-DIRECTION.md` before picking work.
- English only in code, comments, docs and the interface.
- Run browser checks headless in a temporary browser context. Do not open visible windows or use a personal browser profile.
- Offline tests run with `node --test` and must pass without any API key or network.
- Never commit keys, tokens, personal data or absolute local paths. The Gemini key comes from the `GEMINI_API_KEY` environment variable.
- Commit messages are one sentence saying what changed.
