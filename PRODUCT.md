# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Heavy Claude Code and Codex users running several accounts (personal, work, shared work, a second work seat, a Codex login) on one Windows machine. They keep the dashboard open in a side window or check it between sessions. Their job: see how much of each account's 5-hour and weekly limit is left, decide which account to use next, and understand spend per day, model, client and project.

## Product Purpose
A local dashboard that reads each account's real usage and the chat logs on the computer. It shows limit rings with reset countdowns and pace, open chats per account, daily token and estimated-cost history across Claude Code, Codex and OpenCode, and keeps chats, skills and setup synced across accounts. Success is a one-glance answer to "which account has room right now".

## Positioning
Multi-account and multi-client in one place, running locally with no cloud account: it combines live limit data, local log analysis and cross-account chat sync, which no single vendor usage page does.

## Operating Context
Node server on localhost:4777 serving a React/Vite app. Data refreshes by polling. Windows desktop, dark and light themes, usually viewed in a narrow window. Accounts can be added, removed and opened as a Claude Code terminal or Claude Desktop profile from the card menu.

## Capabilities and Constraints
- Account cards: plan chip, 5-hour and weekly rings, reset countdown, pace chip, open chats, folder, status dot (live, idle, expired login).
- Daily usage: tokens or estimated cost, 7/30/90 days and all time, per-model stacked bars, client and model filters, request outcomes, token mix, models table with public prices.
- Providers: Claude (with token renewal) and Codex. Models without a public price are shown as tokens only.
- Real data only: never invent numbers in the product; proposals may use sample data labelled as such.
- Existing assets: real Claude and Codex marks (/icons), Inter font.

## Product Principles
- The answer comes first: remaining headroom per account is visible without scrolling or clicking.
- Honest numbers: estimates are labelled, missing prices stay missing, stale data says it is stale.
- Quiet when idle, loud only when a limit is close.
- Everything is local; nothing implies an upload or a cloud account.

## Accessibility & Inclusion
Keyboard operable, visible focus, respects prefers-reduced-motion, colour never the only signal for limit state.
