# Third-party notices

`server/desktop-label-sync.js` adapts Chromium Local Storage encoding and
Claude sidebar sync marker logic from
[claude-desktop-session-sync](https://github.com/RasmusKD/claude-desktop-session-sync).

MIT License

Copyright (c) 2026 RasmusKD

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Bundled packages

The built web app bundles React, react-dom, motion, lucide-react and the Inter
variable font (@fontsource-variable/inter, SIL OFL 1.1). Their licenses
(MIT, ISC, OFL) require their notices to travel with any redistributed build;
generate a full report with `npx license-checker --production` before
redistributing `dist/`.

## Service icons

`public/icons/claude.svg` and `public/icons/codex.svg` come from
[LobeHub Icons](https://github.com/lobehub/lobe-icons) (`@lobehub/icons-static-svg` 1.102.0, MIT License,
Copyright (c) LobeHub). Claude is a trademark of Anthropic and Codex / OpenAI are trademarks of OpenAI. The marks are
used only to identify which service an account belongs to; this project is not affiliated with either company.
