# Dashboard redesign proposals

Three static, self-contained pages with synthetic sample data (`shared/data.js`). Open any `.html` file in a browser (fonts, GSAP and Lucide load from CDNs).

- `a-ledger.html`: light ruled ledger, liquid fuel-gauge tanks, ghost wordmark and pill nav.
- `b-daylight.html`: gradient sky that shifts with the selected account's headroom, frosted panels, skyline chart.
- `c-command-wall.html`: dark forest bento wall, particle orb showing headroom, dock rail, cursor-following border.

None of these touch the running app. Pick one and it can be ported into `src/`.
