# Changelog

## [2.3.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.2.0...v2.3.0) (2026-04-29)


### Features

* **analytics:** server-side Metrika conversion tracking via Offline Conversions API ([#226](https://github.com/aylisrg/Platform-Delovoy/issues/226)) ([adaa2cd](https://github.com/aylisrg/Platform-Delovoy/commit/adaa2cd36db508830891851f7fdedaf246636166))
* **auth:** Wave 1 — schema + remove Yandex/Google + mergeClients soft-merge fix ([#204](https://github.com/aylisrg/Platform-Delovoy/issues/204)) ([172e963](https://github.com/aylisrg/Platform-Delovoy/commit/172e963686d0a030cae1efc50df3de66db109490))
* **auth:** Wave 2 — Telegram bot deep-link login + auto-merge + auth telemetry ([#207](https://github.com/aylisrg/Platform-Delovoy/issues/207)) ([0662392](https://github.com/aylisrg/Platform-Delovoy/commit/06623921d0f3095cd09f47d99f133cbaf40c4804))
* **gazebos:** dynamic pricing by day-of-week + day rate ([#223](https://github.com/aylisrg/Platform-Delovoy/issues/223)) ([a3cafdd](https://github.com/aylisrg/Platform-Delovoy/commit/a3cafdd3c6b29c1057778bb87842c3900bbc4457))
* **tasks:** unified kanban + channel-agnostic notifications (V1) ([7b809ca](https://github.com/aylisrg/Platform-Delovoy/commit/7b809cab912b974e615c03bb026a0701f7de996e))


### Bug Fixes

* **bot:** respond to returning users and unknown messages ([#227](https://github.com/aylisrg/Platform-Delovoy/issues/227)) ([291870b](https://github.com/aylisrg/Platform-Delovoy/commit/291870be2996804a8d170ac2a9b2934b0f3c27ad))
* **ci:** make _run-migration.yml self-contained (inline pg_dump) ([#216](https://github.com/aylisrg/Platform-Delovoy/issues/216)) ([d5e5219](https://github.com/aylisrg/Platform-Delovoy/commit/d5e5219a9992eec0becea1d72e9e288dd6dbbc73))
* **landing:** restore Yandex map embed and add map to PS Park ([#205](https://github.com/aylisrg/Platform-Delovoy/issues/205)) ([fa06a27](https://github.com/aylisrg/Platform-Delovoy/commit/fa06a27e86264aa9d1fc47d36766b2b0607d2459))
* **ps-park:** address reviewer findings — auto_complete audit + cancel metadata ([630e90e](https://github.com/aylisrg/Platform-Delovoy/commit/630e90e7ff27f18a8292749e3972355ae2133253))
* **ps-park:** session complete/cancel + shift revenue + post-factum items ([fca2fa1](https://github.com/aylisrg/Platform-Delovoy/commit/fca2fa137a15f44286ae8e0135e6e82ff2a2d8b8))
* **tasks:** address reviewer findings (round 1) ([987f526](https://github.com/aylisrg/Platform-Delovoy/commit/987f526cd511397d9857fd38713ac2293d4b823b))
* **tasks:** hoist JSX out of try/catch in admin task page ([9316493](https://github.com/aylisrg/Platform-Delovoy/commit/9316493880a2c8c7ccb1cafca3f1fdadc4823e69))
* **tasks:** mark /report page as dynamic to avoid build-time prisma call ([dc0ea40](https://github.com/aylisrg/Platform-Delovoy/commit/dc0ea403211d75e75e8afc5c131b752c73ba1a9d))

## [2.2.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.1.0...v2.2.0) (2026-04-27)


### Features

* /api/version endpoint + honest src/version.ts ([ba8d83c](https://github.com/aylisrg/Platform-Delovoy/commit/ba8d83cca06cd81f21c0ea76719d9250359a5995))
* **feedback:** link office to feedback items via FK + autocomplete ([3bcb63e](https://github.com/aylisrg/Platform-Delovoy/commit/3bcb63ed8ebab8d3477470c0d007f6576a4f8486))


### Bug Fixes

* **auth:** close magic-link userId vulnerability + open /dashboard cabinet ([5c1382c](https://github.com/aylisrg/Platform-Delovoy/commit/5c1382cdf10475775e4ffa84fd20291fc616e345))
* **feedback:** hide RESERVED offices from combobox per PRD ([13e8778](https://github.com/aylisrg/Platform-Delovoy/commit/13e8778fba39d848ad58fbf61e281b1524e545b1))

## [2.1.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.0.0...v2.1.0) (2026-04-25)


### Features

* **bot:** /settings command — release notifications toggle for the team ([d15570d](https://github.com/aylisrg/Platform-Delovoy/commit/d15570dff4a1924919a792c25dc70ad12ba77d0d))


### Bug Fixes

* **inventory:** unbreak /admin/inventory + add RSC boundary guard ([9277748](https://github.com/aylisrg/Platform-Delovoy/commit/9277748f568542454993e740379fc902c4cabded))
* **landing:** restore Yandex map + sync coords to actual park location ([8947a53](https://github.com/aylisrg/Platform-Delovoy/commit/8947a53ebaf01cdeb10a4d6d06241bbfd83e091e))


### Performance Improvements

* &lt;img&gt; → next/image для аватаров и фото ресурсов ([187851f](https://github.com/aylisrg/Platform-Delovoy/commit/187851f36f5371fe3b7d6efba40cc80e7b7e15db))

## [2.0.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.9.1...v2.0.0) (2026-04-25)


### ⚠ BREAKING CHANGES

* **tasks:** new required Prisma migration `20260424120000_add_tasks_module` adds 5 tables + 6 enums. Any environment must run `npx prisma migrate deploy` and `npm run db:seed` (populates default categories + tasks Module row) before the new admin section becomes usable. Outbound notifications reuse the existing SMTP channel — no config change required. Inbound IMAP is gated behind INBOUND_EMAIL_ENABLED=false by default; enable once a dedicated mailbox (e.g. reports@delovoy-park.ru) is provisioned.

### Features

* split email auth into password & magic-link modes with provider status check ([#174](https://github.com/aylisrg/Platform-Delovoy/issues/174)) ([d0438bf](https://github.com/aylisrg/Platform-Delovoy/commit/d0438bfc9720b9e5bb3be50b91dd8946ee2c1cd6))
* **tasks:** v2.0 — task tracker + tenant issue intake ([#178](https://github.com/aylisrg/Platform-Delovoy/issues/178)) ([73b0226](https://github.com/aylisrg/Platform-Delovoy/commit/73b02260fdb7ed7c707c5041a4e05f607e8dc087))


### Bug Fixes

* **analytics:** correct cost attribution + add balance, professional analyst view ([#182](https://github.com/aylisrg/Platform-Delovoy/issues/182)) ([12d8cbc](https://github.com/aylisrg/Platform-Delovoy/commit/12d8cbcf8ab402e696102891516a9280c89ec991))
* **inventory:** batch total in receipt editor + auto-confirm on edit ([#175](https://github.com/aylisrg/Platform-Delovoy/issues/175)) ([1f14ebe](https://github.com/aylisrg/Platform-Delovoy/commit/1f14ebe696285d1b15ff05fb0788fb3b2cef4f7d))
* **inventory:** comprehensive receipt delete — all batch sources + error logging ([#179](https://github.com/aylisrg/Platform-Delovoy/issues/179)) ([20680ae](https://github.com/aylisrg/Platform-Delovoy/commit/20680ae350eaabdc9c3b900a872880d26d0aa0be))
* **inventory:** fix DELETE 500 + receipt edit price input ([#177](https://github.com/aylisrg/Platform-Delovoy/issues/177)) ([e6bf5a8](https://github.com/aylisrg/Platform-Delovoy/commit/e6bf5a8a15ed45aecaa090d786c5706342471709))
* **inventory:** remove bogus V1 lookup from receipt DELETE (Prisma validation error) ([#180](https://github.com/aylisrg/Platform-Delovoy/issues/180)) ([bbbf853](https://github.com/aylisrg/Platform-Delovoy/commit/bbbf853d248589781a259489f55ebde05602cf70))

## [1.9.1](https://github.com/aylisrg/Platform-Delovoy/compare/v1.9.0...v1.9.1) (2026-04-23)


### Bug Fixes

* warehouse receipts now auto-confirm for ADMIN, stock updates immediately ([#172](https://github.com/aylisrg/Platform-Delovoy/issues/172)) ([dfe818b](https://github.com/aylisrg/Platform-Delovoy/commit/dfe818b0a332256b922b2ca55b1a0aaa8515b72a))

## [1.9.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.8.1...v1.9.0) (2026-04-23)


### Features

* implement role-based edit permissions and admin section access control ([#169](https://github.com/aylisrg/Platform-Delovoy/issues/169)) ([4bed98c](https://github.com/aylisrg/Platform-Delovoy/commit/4bed98ca3ac01fce671d34bfb5a68fc516185282))

## [1.8.1](https://github.com/aylisrg/Platform-Delovoy/compare/v1.8.0...v1.8.1) (2026-04-23)


### Bug Fixes

* **rbac:** grant ADMIN role access to all admin sections and hard-delete ([#167](https://github.com/aylisrg/Platform-Delovoy/issues/167)) ([ae670c0](https://github.com/aylisrg/Platform-Delovoy/commit/ae670c0986172721b47a3e535ed7431eb8119059))

## [1.8.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.7.0...v1.8.0) (2026-04-23)


### Features

* **format:** unified date/time formatting (24h, dd-mm-yyyy) + ESLint rule ([#162](https://github.com/aylisrg/Platform-Delovoy/issues/162)) ([020e5b7](https://github.com/aylisrg/Platform-Delovoy/commit/020e5b76afb5cc5a0f69cea98231fa39feeee283))


### Bug Fixes

* **inventory:** recalculate stock after receipt hard-delete ([#165](https://github.com/aylisrg/Platform-Delovoy/issues/165)) ([45e256b](https://github.com/aylisrg/Platform-Delovoy/commit/45e256ba425a8a7e0ab1c94934e9e8ed6da9daa7))
* **inventory:** sync stock on receipt edit via recalculateStock + batch receiptTxId link ([#161](https://github.com/aylisrg/Platform-Delovoy/issues/161)) ([f06db91](https://github.com/aylisrg/Platform-Delovoy/commit/f06db91c269ea92975a9d87a01260369a7bda3a4))
* **ps-park:** filter soft-deleted bookings in all reads + role-gated hard delete ([#160](https://github.com/aylisrg/Platform-Delovoy/issues/160)) ([acc885a](https://github.com/aylisrg/Platform-Delovoy/commit/acc885a104500c4f4036589ef248376b724bd0c8))

## [1.7.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.6.0...v1.7.0) (2026-04-22)


### Features

* **ps-park:** bill by actual played time + 15-min rounding ([#159](https://github.com/aylisrg/Platform-Delovoy/issues/159)) ([e0f3809](https://github.com/aylisrg/Platform-Delovoy/commit/e0f38096104b8d3f2dec0b813df58304f114653d))


### Bug Fixes

* **inventory:** receipt detail RBAC, error state & SUPERADMIN delete ([#155](https://github.com/aylisrg/Platform-Delovoy/issues/155)) ([44a5ede](https://github.com/aylisrg/Platform-Delovoy/commit/44a5edeb6d52c6f95d35a929f04b7b72882122f8))
* **inventory:** receipt save, unified date format, stock from batches ([#158](https://github.com/aylisrg/Platform-Delovoy/issues/158)) ([9d08c62](https://github.com/aylisrg/Platform-Delovoy/commit/9d08c6254f00db22c352a96dec9ad23df5ffe6ae))

## [1.6.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.5.0...v1.6.0) (2026-04-21)


### Features

* add SuperAdmin booking deletion for gazebos and ps-park ([#138](https://github.com/aylisrg/Platform-Delovoy/issues/138)) ([a3a0401](https://github.com/aylisrg/Platform-Delovoy/commit/a3a0401f20b074606368852c581995a24539be47))
* **admin:** draggable cards on dashboard ([#142](https://github.com/aylisrg/Platform-Delovoy/issues/142)) ([e46de38](https://github.com/aylisrg/Platform-Delovoy/commit/e46de38756f954ffb361d89e7352727f68433d45))
* **admin:** notification routing — per-module Telegram chat configuration ([#125](https://github.com/aylisrg/Platform-Delovoy/issues/125)) ([8b4613c](https://github.com/aylisrg/Platform-Delovoy/commit/8b4613cbf97b40a76879aca4d5cc2fa4622b748e))
* **admin:** SUPERADMIN-only deletion with password confirmation + audit journal ([#145](https://github.com/aylisrg/Platform-Delovoy/issues/145)) ([1f5e01c](https://github.com/aylisrg/Platform-Delovoy/commit/1f5e01cc2c3d1b5bdbd1bf2fc0d27698df8c0895))
* **infra:** staging environment + app-level backup strategy ([#146](https://github.com/aylisrg/Platform-Delovoy/issues/146)) ([d2df145](https://github.com/aylisrg/Platform-Delovoy/commit/d2df145c1691417decd4dfddf8032f720c32ecca))
* **inventory:** edit receipts & view correction history ([#149](https://github.com/aylisrg/Platform-Delovoy/issues/149)) ([5bfc20d](https://github.com/aylisrg/Platform-Delovoy/commit/5bfc20da0cf960742081c2bb464f2677fe971f1a))
* **inventory:** receipt detail page with edit, correction & history ([#153](https://github.com/aylisrg/Platform-Delovoy/issues/153)) ([e3eca61](https://github.com/aylisrg/Platform-Delovoy/commit/e3eca61b72e7974444c0dec1785e078dac3c2628))
* move logout button to header and add version footer in admin ([#137](https://github.com/aylisrg/Platform-Delovoy/issues/137)) ([16dceec](https://github.com/aylisrg/Platform-Delovoy/commit/16dceec05a507a4b9257f1fc034d0284c989e6e3))
* **rental:** auto-create deals in pipeline when inquiry submitted ([#127](https://github.com/aylisrg/Platform-Delovoy/issues/127)) ([30a313b](https://github.com/aylisrg/Platform-Delovoy/commit/30a313b34381aa27db8bbfdf61e7527a910c4aa8))
* **rental:** email notifications & payment tracking system ([#143](https://github.com/aylisrg/Platform-Delovoy/issues/143)) ([922f5b3](https://github.com/aylisrg/Platform-Delovoy/commit/922f5b34e1404368600c577c6ef93c843fcc4c64))
* **rental:** Kanban-воронка продаж аренды с drag-and-drop ([#124](https://github.com/aylisrg/Platform-Delovoy/issues/124)) ([c5d0041](https://github.com/aylisrg/Platform-Delovoy/commit/c5d0041775029136b449de0214d821b0010c1b72))
* **ux:** call widget redesign with visible phone number for Барбекью и Плей Парк ([#151](https://github.com/aylisrg/Platform-Delovoy/issues/151)) ([55ca8cb](https://github.com/aylisrg/Platform-Delovoy/commit/55ca8cb6894c57b87ef7d75fc12d8b2057ca9de1))


### Bug Fixes

* **auth:** fix Telegram/Yandex/email auth + remove WhatsApp ([#152](https://github.com/aylisrg/Platform-Delovoy/issues/152)) ([88a121e](https://github.com/aylisrg/Platform-Delovoy/commit/88a121ebaab2d18c686aceac7120cdd11ed3837d))
* **email:** switch SMTP to port 587 (STARTTLS) — 465 blocked by VPS ([#150](https://github.com/aylisrg/Platform-Delovoy/issues/150)) ([43407ac](https://github.com/aylisrg/Platform-Delovoy/commit/43407acc3d0a9cbb0d6e1f95aa16d4d8d2bba27b))
* **inventory:** auto-confirm receipt on create for SUPERADMIN/ADMIN ([#144](https://github.com/aylisrg/Platform-Delovoy/issues/144)) ([2cb33dd](https://github.com/aylisrg/Platform-Delovoy/commit/2cb33dd26f4824d9a87972c7db8625d6796103ea))
* **users:** add ADMIN to role enum validation schemas ([#141](https://github.com/aylisrg/Platform-Delovoy/issues/141)) ([5c4a24f](https://github.com/aylisrg/Platform-Delovoy/commit/5c4a24f8371a167996c3381cf1f1d3511b8fde5b))

## [1.5.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.4.0...v1.5.0) (2026-04-18)


### Features

* **admin:** mobile UI for gazebos, shift logout prompt, sidebar sign-out ([#118](https://github.com/aylisrg/Platform-Delovoy/issues/118)) ([01cfb41](https://github.com/aylisrg/Platform-Delovoy/commit/01cfb41520a6209c4e13e6b882e2a8cb3a2531da))
* **booking:** checkout discount system ([#117](https://github.com/aylisrg/Platform-Delovoy/issues/117)) ([0504a6c](https://github.com/aylisrg/Platform-Delovoy/commit/0504a6c5c19922982cd53adb9849934ca675babe))
* **email:** switch transactional email to Yandex SMTP via nodemailer ([#119](https://github.com/aylisrg/Platform-Delovoy/issues/119)) ([38b1bd8](https://github.com/aylisrg/Platform-Delovoy/commit/38b1bd8a3e097f873eecad0b28f739c820020e81))
* **seo:** security headers, JSON-LD schemas, GEO meta, OG image, PWA manifest ([#123](https://github.com/aylisrg/Platform-Delovoy/issues/123)) ([41af0b3](https://github.com/aylisrg/Platform-Delovoy/commit/41af0b30e3eb48ce35af304a23895fb80a939dd2))
* unified user management — signin, profile channels, admin registry ([#115](https://github.com/aylisrg/Platform-Delovoy/issues/115)) ([2d0b8bc](https://github.com/aylisrg/Platform-Delovoy/commit/2d0b8bc810d9a539e29c41f7a0849227daa0e440))


### Bug Fixes

* **admin:** RBAC fixes for ADMIN role — auth middleware, TypeScript errors, test coverage ([#122](https://github.com/aylisrg/Platform-Delovoy/issues/122)) ([dd23fe2](https://github.com/aylisrg/Platform-Delovoy/commit/dd23fe2641eafd5c98d63280ffedfafba7e58d2c))

## [1.5.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.4.0...v1.5.0) (2026-04-18)


### Features

* **admin:** mobile UI for gazebos, shift logout prompt, sidebar sign-out ([#118](https://github.com/aylisrg/Platform-Delovoy/issues/118)) ([01cfb41](https://github.com/aylisrg/Platform-Delovoy/commit/01cfb41520a6209c4e13e6b882e2a8cb3a2531da))
* **booking:** checkout discount system ([#117](https://github.com/aylisrg/Platform-Delovoy/issues/117)) ([0504a6c](https://github.com/aylisrg/Platform-Delovoy/commit/0504a6c5c19922982cd53adb9849934ca675babe))
* unified user management — signin, profile channels, admin registry ([#115](https://github.com/aylisrg/Platform-Delovoy/issues/115)) ([2d0b8bc](https://github.com/aylisrg/Platform-Delovoy/commit/2d0b8bc810d9a539e29c41f7a0849227daa0e440))


### Bug Fixes

* **admin:** RBAC fixes for ADMIN role — auth middleware, TypeScript errors, test coverage ([#122](https://github.com/aylisrg/Platform-Delovoy/issues/122)) ([dd23fe2](https://github.com/aylisrg/Platform-Delovoy/commit/dd23fe2641eafd5c98d63280ffedfafba7e58d2c))

## [1.4.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.3.0...v1.4.0) (2026-04-17)


### Features

* **telegram:** notification flow map, Mini App auth linking, notification preferences ([#109](https://github.com/aylisrg/Platform-Delovoy/issues/109)) ([1856d71](https://github.com/aylisrg/Platform-Delovoy/commit/1856d719db151e64f560b0078b041d7cfc287cb8))
* Yandex OAuth + HTML email service + call widget + landing polish ([#113](https://github.com/aylisrg/Platform-Delovoy/issues/113)) ([6407e36](https://github.com/aylisrg/Platform-Delovoy/commit/6407e36816256975aab7d567a2ecb90acb38be93))


### Bug Fixes

* **auth:** resolve MANAGER login — forbidden redirect loop + section sync ([#111](https://github.com/aylisrg/Platform-Delovoy/issues/111)) ([4f5c3ba](https://github.com/aylisrg/Platform-Delovoy/commit/4f5c3bac1b796e3d3d14699c08730281d7df00c9))
* **ci:** repair broken workflows — watchdog YAML, deploy, build-once ([#112](https://github.com/aylisrg/Platform-Delovoy/issues/112)) ([2a82b26](https://github.com/aylisrg/Platform-Delovoy/commit/2a82b26b50385a515ccaf74c202014cc34a15e65))

## [1.3.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.2.0...v1.3.0) (2026-04-17)


### Features

* **admin:** mobile-first redesign of admin panel ([#104](https://github.com/aylisrg/Platform-Delovoy/issues/104)) ([d03ec32](https://github.com/aylisrg/Platform-Delovoy/commit/d03ec32c2efe51fcbcfdd4abe2282164d94fdb4c))
* **agents:** поднять agent flow до 10/10 — security, evals, native sub-agents, dashboard ([#106](https://github.com/aylisrg/Platform-Delovoy/issues/106)) ([87cda1f](https://github.com/aylisrg/Platform-Delovoy/commit/87cda1f70cf5baa647a95f1c271e0cadae3c8eee))
* **dashboard:** server status widget with host metrics ([#105](https://github.com/aylisrg/Platform-Delovoy/issues/105)) ([cb65366](https://github.com/aylisrg/Platform-Delovoy/commit/cb65366d0a600a70403501a3c1c90de5269e4337))
* **notifications:** Telegram release notifications ([#97](https://github.com/aylisrg/Platform-Delovoy/issues/97)) ([2cc92b9](https://github.com/aylisrg/Platform-Delovoy/commit/2cc92b90d2b2a83f28c870ea21e9b53120ee5473))
* аналитика рекламы, release notes, profile auth, Novofon CRM ([#102](https://github.com/aylisrg/Platform-Delovoy/issues/102)) ([6445fdb](https://github.com/aylisrg/Platform-Delovoy/commit/6445fdbcdc40a9a0826c733b5ca70ebd57b50dd4))


### Bug Fixes

* **auth:** hotfix manager email+password login — 3 bugs ([#108](https://github.com/aylisrg/Platform-Delovoy/issues/108)) ([620d9f3](https://github.com/aylisrg/Platform-Delovoy/commit/620d9f32dc5a142e54126dbc05bcf1f5ee2ecef1))
* **ci:** aggressive Docker cleanup — disk 100% full ([5263668](https://github.com/aylisrg/Platform-Delovoy/commit/52636684963eba942c4a4eccff1d9a7dd8ca1ad3))
* **users:** auto-assign dashboard permission when creating MANAGER ([#99](https://github.com/aylisrg/Platform-Delovoy/issues/99)) ([86aebc1](https://github.com/aylisrg/Platform-Delovoy/commit/86aebc19d2eb2f86354a65142bf2ec98c5d5a1df))

## [1.2.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.1.0...v1.2.0) (2026-04-16)


### Features

* **ci:** add CI Watchdog — pure GitHub Actions, no AI dependency ([#95](https://github.com/aylisrg/Platform-Delovoy/issues/95)) ([cea2dd2](https://github.com/aylisrg/Platform-Delovoy/commit/cea2dd208c76b850de32414b7ac2f095769c4ebb))
* post-launch micro-fixes batch + safe migrations ([#90](https://github.com/aylisrg/Platform-Delovoy/issues/90)) ([c2d9f28](https://github.com/aylisrg/Platform-Delovoy/commit/c2d9f2810ee2763e288df9ede2738763f5f44465))
* **profile:** seamless login + contacts management in personal cabinet ([#96](https://github.com/aylisrg/Platform-Delovoy/issues/96)) ([d4b3e17](https://github.com/aylisrg/Platform-Delovoy/commit/d4b3e174dd1b58256b4a0083f225a3df8213c9b0))
* Telegram Mini App — полноценный B2C клиент внутри Telegram ([#92](https://github.com/aylisrg/Platform-Delovoy/issues/92)) ([36b3819](https://github.com/aylisrg/Platform-Delovoy/commit/36b3819885f3eef0add91a44afaf0a87f24b02dd))


### Bug Fixes

* **auth:** skip email form after Telegram login ([#91](https://github.com/aylisrg/Platform-Delovoy/issues/91)) ([b95b894](https://github.com/aylisrg/Platform-Delovoy/commit/b95b894f53c741aea2edb67b8c3e975e2a296cd2))
* auto-restore rental data on deploy ([#92](https://github.com/aylisrg/Platform-Delovoy/issues/92)) ([c783dae](https://github.com/aylisrg/Platform-Delovoy/commit/c783dae2c325b8fbd8f68b20cf735ea2001dc7fe))
* sync DB schema on deploy (prisma db push) ([#88](https://github.com/aylisrg/Platform-Delovoy/issues/88)) ([e9a087d](https://github.com/aylisrg/Platform-Delovoy/commit/e9a087dab8b8d8f9adf2a654c39757ba598dd650))

## [1.1.0](https://github.com/aylisrg/Platform-Delovoy/compare/v1.0.0...v1.1.0) (2026-04-15)


### Features

* feedback module, telegram dashboard, CI/CD improvements ([#84](https://github.com/aylisrg/Platform-Delovoy/issues/84)) ([8a7f940](https://github.com/aylisrg/Platform-Delovoy/commit/8a7f94045ce3f6bfccc1d377c2a58164df3c15e7))


### Bug Fixes

* **ci:** paths-ignore + Telegram notifications ([#86](https://github.com/aylisrg/Platform-Delovoy/issues/86)) ([ccae2d2](https://github.com/aylisrg/Platform-Delovoy/commit/ccae2d2835a9fef39f11c8a3bd018f1eec0036e2))
* **seed:** migrate legacy admin instead of deleting (FK constraints) ([#87](https://github.com/aylisrg/Platform-Delovoy/issues/87)) ([d65cefe](https://github.com/aylisrg/Platform-Delovoy/commit/d65cefe8f963a4b8b00165c8a65e084636307d65))

## 1.0.0 (2026-04-15)


### Features

* add auto-fix CI workflow via Claude Code Action ([3ff94c8](https://github.com/aylisrg/Platform-Delovoy/commit/3ff94c8be0feddde4687db11ae338c57af3ec56d))
* add cafe module — menu, orders, public page, manager panel (#p2-cafe) ([d5e8299](https://github.com/aylisrg/Platform-Delovoy/commit/d5e82990303823d0d36646a4d3a9e6899e60885d))
* add googleapis dependency for Google Calendar integration ([531257e](https://github.com/aylisrg/Platform-Delovoy/commit/531257eb1f883d25dd0435e74581a18eedbd02f7))
* add landing page with hero, services, offices, and waitlist ([20b769d](https://github.com/aylisrg/Platform-Delovoy/commit/20b769df49923aada3b56cb564fd9be420d86e75))
* add parking info module (#p2-parking) ([6c45654](https://github.com/aylisrg/Platform-Delovoy/commit/6c45654ad88b6bee620f88f5902fdcbca56006c9))
* add password-based admin login and user management ([ed0e73c](https://github.com/aylisrg/Platform-Delovoy/commit/ed0e73cf50a61b80110734906c4402b516e565bd))
* add post-deploy script for DB migration + admin seed ([30f76df](https://github.com/aylisrg/Platform-Delovoy/commit/30f76df229c143e6d191ebc42a0f97c96cb55510))
* add Timeweb API token to deploy pipeline ([4b19cf8](https://github.com/aylisrg/Platform-Delovoy/commit/4b19cf8f33f19fd3d59be5cd2ed3bfc02bdfe2eb))
* add user dashboard — personal bookings and orders (#p2-dashboard) ([ed67959](https://github.com/aylisrg/Platform-Delovoy/commit/ed679595395b11c086d40ddcd8154c5b53d232aa))
* admin permissions, multi-channel notifications, landing ([2b22297](https://github.com/aylisrg/Platform-Delovoy/commit/2b2229747b62b55c62fd916f7f8e01a1c36d26c6))
* **admin:** add admin shell with dashboard, modules, monitoring, users ([75afe16](https://github.com/aylisrg/Platform-Delovoy/commit/75afe165712fa19ec7ac96cc2859327f171a6038))
* **admin:** double-click to rename sidebar groups ([#50](https://github.com/aylisrg/Platform-Delovoy/issues/50)) ([c10d298](https://github.com/aylisrg/Platform-Delovoy/commit/c10d2986714b92c8ad6b396c1f110d766b6e001e))
* **admin:** draggable sidebar with group support ([#48](https://github.com/aylisrg/Platform-Delovoy/issues/48)) ([8c680ab](https://github.com/aylisrg/Platform-Delovoy/commit/8c680abec007b4dcb438f97d793443599a1f8921))
* **admin:** move stock button to header, add price editing for resources ([0013e15](https://github.com/aylisrg/Platform-Delovoy/commit/0013e158659340dc4eb9372bdefa6e49166c040f))
* **admin:** управленческие панели Барбекю/Плей Парк + защита БД ([#81](https://github.com/aylisrg/Platform-Delovoy/issues/81)) ([4aac4b7](https://github.com/aylisrg/Platform-Delovoy/commit/4aac4b7ec0dac4134b9f58cd04441507615f8f05))
* **api:** add standardized API responses, rate limiting, and logger ([06e68ee](https://github.com/aylisrg/Platform-Delovoy/commit/06e68eefa30055ba95c07fcebefa5e711d49f383))
* auth popup for unauthenticated booking ([19abc8c](https://github.com/aylisrg/Platform-Delovoy/commit/19abc8cf70d7c8826dbc0f811f583898a0b23b39))
* **auth:** add NextAuth.js with RBAC, permissions, and middleware ([e1a8756](https://github.com/aylisrg/Platform-Delovoy/commit/e1a8756cd64ea913389c9467e2d2eaa966722cb5))
* **booking:** Booking Engine v2 Phase 1A — check-in, no-show, pricing, cancellation policy ([#46](https://github.com/aylisrg/Platform-Delovoy/issues/46)) ([f854d1f](https://github.com/aylisrg/Platform-Delovoy/commit/f854d1ffc4b7ffd2b5983401f12f124e960d8e0a))
* **bot:** add Telegram bot with gazebo booking flow via Grammy ([9003da0](https://github.com/aylisrg/Platform-Delovoy/commit/9003da04be8a50ce62705ba377c6f68712929e85))
* CI/CD автодеплой на Timeweb VPS через GitHub Actions ([824f26d](https://github.com/aylisrg/Platform-Delovoy/commit/824f26d9a705c4452f6f02b7afa47cb1946f1de5))
* **db:** add Prisma schema with all domain models and seed script ([39d657b](https://github.com/aylisrg/Platform-Delovoy/commit/39d657b7df507cd76109e4f0fcd886f48d80e6ec))
* **deploy:** add verify job — external HTTP health check after deploy ([190794a](https://github.com/aylisrg/Platform-Delovoy/commit/190794a14fb36ec95b804c5e7241fe90e56221a8))
* **devops:** agent pipeline v2, CI/CD improvements, PS Park timezone fix ([#58](https://github.com/aylisrg/Platform-Delovoy/issues/58)) ([49fe245](https://github.com/aylisrg/Platform-Delovoy/commit/49fe245616794c1f7ca6a7c0cb7057f8bb78b7c0))
* **devops:** staging, manual deploy, safe migrations, smoke tests ([#82](https://github.com/aylisrg/Platform-Delovoy/issues/82)) ([6041fd0](https://github.com/aylisrg/Platform-Delovoy/commit/6041fd0842c95b859f106bb94c85b26d75d5f803))
* download all media files from delovoy-park.ru website ([42ef74b](https://github.com/aylisrg/Platform-Delovoy/commit/42ef74b4ba16ccc19cdb2de05b883e566af9a706))
* email magic link authentication ([087dcf3](https://github.com/aylisrg/Platform-Delovoy/commit/087dcf3ec3567742f90c33e4da1f00cf8e0f5bb3))
* **frontend:** add inventory item picker to booking flows ([c627c16](https://github.com/aylisrg/Platform-Delovoy/commit/c627c16200dc59e10da42157ee081de80b41a13c))
* full clean deploy on Timeweb — wipe server + fresh install ([ef7eceb](https://github.com/aylisrg/Platform-Delovoy/commit/ef7eceb23b10a775dc8e12d3308df74c0a019c44))
* gazebo booking flow, admin booking, dark theme UI, favicon ([1a294c3](https://github.com/aylisrg/Platform-Delovoy/commit/1a294c3a50627d3d85bc6d2d88402f2ecb16d8f5))
* **gazebos:** add manager panel and fix admin route structure ([5f5da3c](https://github.com/aylisrg/Platform-Delovoy/commit/5f5da3c977d2ff2c28dcf5bb3427ece66baf2317))
* **gazebos:** add marketing analytics dashboard (Avito + Yandex) ([22faaf0](https://github.com/aylisrg/Platform-Delovoy/commit/22faaf0432f70a7747310e3664e1c34039169dc3))
* **gazebos:** add public page with resource list and availability calendar ([98e4bf6](https://github.com/aylisrg/Platform-Delovoy/commit/98e4bf6628320c7af1af1e31770ec9eb423687d1))
* **gazebos:** add REST API for bookings, resources, and availability ([8acd5ce](https://github.com/aylisrg/Platform-Delovoy/commit/8acd5cee6be7f1ebbde351ef8346aea9a0c6eff2))
* **gazebos:** add service layer with booking, resources, and availability ([7f8432d](https://github.com/aylisrg/Platform-Delovoy/commit/7f8432d86a87df1a8541d9d2c1bf2393151fa4bb))
* **gazebos:** marketing analytics dashboard — Авито + Яндекс ([108c0f3](https://github.com/aylisrg/Platform-Delovoy/commit/108c0f3ba08cb7c678bb482f7f78c66e2cea214e))
* Google Calendar sync + browser push notifications for admin ([e645736](https://github.com/aylisrg/Platform-Delovoy/commit/e645736f2cd6dbcc3a3bdcbadbb8c2513b7764c9))
* integrate Timeweb Cloud API for server monitoring and management ([4e37385](https://github.com/aylisrg/Platform-Delovoy/commit/4e373859b4cfafe88946a315baf210bc205a3150))
* inventory fixes, prices page, detailed PS Park session bills ([#54](https://github.com/aylisrg/Platform-Delovoy/issues/54)) ([85bda05](https://github.com/aylisrg/Platform-Delovoy/commit/85bda0599330ec7d82e5e7db3bfb4e3a5b306b6e))
* inventory system + booking product sales (PS Park & Gazebos) ([d5fe8c0](https://github.com/aylisrg/Platform-Delovoy/commit/d5fe8c0e4db7e4243f4a2bd49cee6c2a1616a176))
* Inventory v2, Novofon телефония, Easter Eggs ([#47](https://github.com/aylisrg/Platform-Delovoy/issues/47)) ([#47](https://github.com/aylisrg/Platform-Delovoy/issues/47)) ([20f51bb](https://github.com/aylisrg/Platform-Delovoy/commit/20f51bbf62d748bf2ea6f9fb0d5e947611980092))
* **inventory:** add inventory module + sales integration for PS Park & gazebos ([652d5fa](https://github.com/aylisrg/Platform-Delovoy/commit/652d5fa0fcca1a09ee38e60aef4de6c3412716e3))
* **inventory:** free-text receipt, fix button color, clear test data ([a0d7429](https://github.com/aylisrg/Platform-Delovoy/commit/a0d74294f4054ef10b1d8484c151908026bbb1f8))
* **inventory:** приход товара — кастомное название, дата, история, очистка тестов ([#43](https://github.com/aylisrg/Platform-Delovoy/issues/43)) ([c38ff5e](https://github.com/aylisrg/Platform-Delovoy/commit/c38ff5e8d848609d2abe67a712c2b83434ab9c50))
* landing page + improved PO agent prompt ([bfe915b](https://github.com/aylisrg/Platform-Delovoy/commit/bfe915b4a8543643579f07abe6c1be100b444bd1))
* mega landing — video hero + Yandex Maps reviews ([b644dd6](https://github.com/aylisrg/Platform-Delovoy/commit/b644dd630ad5b3bc526d9bd48c859b05bf2ddd43))
* **monitoring:** add health checks, event service, and Telegram alerts ([19a957c](https://github.com/aylisrg/Platform-Delovoy/commit/19a957cc9d6691761adc73c549a5dc91e3fa2fbe))
* **notifications:** add booking notification service and API ([6e06d8e](https://github.com/aylisrg/Platform-Delovoy/commit/6e06d8e025a72b57493fbe7dd4fe9b90b2b55181))
* Phase 4 — Дашборд архитектора ([ddc834d](https://github.com/aylisrg/Platform-Delovoy/commit/ddc834d3462aa7bea10bcd6915f3eb0bbc381801))
* Platform Delovoy — Phase 0 + Phase 1 + Phase 2 (Full B2C) ([a913430](https://github.com/aylisrg/Platform-Delovoy/commit/a9134305fb3550ee1a5fe65ca8a8c3c0da9aa4cd))
* **ps-park:** add admin client booking form to PS Park dashboard ([#44](https://github.com/aylisrg/Platform-Delovoy/issues/44)) ([8d05148](https://github.com/aylisrg/Platform-Delovoy/commit/8d05148e88cf7fceb08581171aa9f389f3707b48))
* **ps-park:** shift handover, split payment, financial ledger, flexible booking times ([#79](https://github.com/aylisrg/Platform-Delovoy/issues/79)) ([907acdf](https://github.com/aylisrg/Platform-Delovoy/commit/907acdf557c944a76e0a7300ba656a3b2c392d01))
* **ps-park:** UX redesign — timeline, active sessions, quick booking ([#45](https://github.com/aylisrg/Platform-Delovoy/issues/45)) ([9ae035c](https://github.com/aylisrg/Platform-Delovoy/commit/9ae035cbf792ff631aae5b3e5b1be13f974c1f9f))
* **ps-park:** тёмная страница + 9 bugfixes (SSE TDZ, React, TS) ([#49](https://github.com/aylisrg/Platform-Delovoy/issues/49)) ([eb5da5f](https://github.com/aylisrg/Platform-Delovoy/commit/eb5da5fff12108f13949686288dd4d3420607a3c))
* **pspark:** add full PS Park module (API, pages, manager) ([a474e37](https://github.com/aylisrg/Platform-Delovoy/commit/a474e377d8252c3435467334e95dad8543b36338))
* **pspark:** add PS Park service layer ([e1f5ad2](https://github.com/aylisrg/Platform-Delovoy/commit/e1f5ad2f83863cc538a606c4ebf381f826133a63))
* **rental:** CRM-модуль аренды — полный CRUD, импорт из Excel, аудит ([#53](https://github.com/aylisrg/Platform-Delovoy/issues/53)) ([5e2cb88](https://github.com/aylisrg/Platform-Delovoy/commit/5e2cb8819c3cfc4c6fed07fee47cbca0fddb7f86))
* **rental:** implement Phase 3 — B2B office rental module ([8b30d67](https://github.com/aylisrg/Platform-Delovoy/commit/8b30d67486deed08132d7c9a2f5733d9453b6f37))
* **rental:** implement Phase 3 — B2B office rental module ([35f16da](https://github.com/aylisrg/Platform-Delovoy/commit/35f16da6f55771601c1959de85cb4fa1ca9a85e1))
* **scaffold:** initialize Next.js 15 project with full directory structure ([27d50c9](https://github.com/aylisrg/Platform-Delovoy/commit/27d50c93c9df7680864c8c797b6b0815420be423))
* Telegram bot + auth + notifications + admin panel ([4bb57aa](https://github.com/aylisrg/Platform-Delovoy/commit/4bb57aae4d0442a0d73ffdc4c758b5529dc5e317))
* update home page with module links and navigation ([3117c0b](https://github.com/aylisrg/Platform-Delovoy/commit/3117c0b23e5c6e7ec78657e6b719a12a9a0b21cf))
* добавлен all-in-one скрипт деплоя ([fbd6a0e](https://github.com/aylisrg/Platform-Delovoy/commit/fbd6a0e58e56a83b897a9e724617924a7b0dbf7f))
* подготовка к деплою на Timeweb VPS + исправления ([c93e292](https://github.com/aylisrg/Platform-Delovoy/commit/c93e2920321111fe0cdb187056a5ffea0e1f45f7))
* раздел Клиенты в админке ([1aced8a](https://github.com/aylisrg/Platform-Delovoy/commit/1aced8aef431e833d7a01ef5775ad5b0f0ba5a0f))


### Bug Fixes

* add db push + seed to docker-entrypoint for password auth ([82780a1](https://github.com/aylisrg/Platform-Delovoy/commit/82780a1d69244b8d95393b52fd63a4ea425216b3))
* add Docker disk cleanup before image pull (disk full on VPS) ([76f1b86](https://github.com/aylisrg/Platform-Delovoy/commit/76f1b86f5cf2ad79600540c034863ce7d4b0ae43))
* add framer-motion dependency for toast component ([2411a9b](https://github.com/aylisrg/Platform-Delovoy/commit/2411a9b6bb45b74480e7bb40f3e565c1880389bb))
* add setup-buildx-action to fix GHCR cache export error ([d80be24](https://github.com/aylisrg/Platform-Delovoy/commit/d80be241a3fffa3773afe93ff5393eb87098b039))
* add tsx, bcryptjs, seed script to Docker runner for admin auth ([e64d0a1](https://github.com/aylisrg/Platform-Delovoy/commit/e64d0a1a4b7b55c9c45d389b8af46b9bdfba620c))
* aggressive disk cleanup + smaller Docker image for 15GB VPS ([0832806](https://github.com/aylisrg/Platform-Delovoy/commit/0832806952abf84d0a8c76164824bd3fb3e21be4))
* aggressive disk cleanup + smaller image (disk full 98%) ([bf040ce](https://github.com/aylisrg/Platform-Delovoy/commit/bf040ced92b83cc3805dce3532168bc30d83f8b7))
* **ci:** fix Zod v4 incompatible enum params in timeweb validation ([0c2e2dc](https://github.com/aylisrg/Platform-Delovoy/commit/0c2e2dcccf10d52e47dcf888eb24f46fbeffc36a))
* clean deploy workflow — use GitHub Secrets, remove hardcoded creds ([166764a](https://github.com/aylisrg/Platform-Delovoy/commit/166764a208185cd5acf60ad3ca21d41b90db19f7))
* copy prisma schema before npm ci in Dockerfile ([76aa841](https://github.com/aylisrg/Platform-Delovoy/commit/76aa841de9511078c12b384f3b780b750517674a))
* corrupted UTF-8 in cafe error message, dateTo filter excluding end date ([9d7fdd1](https://github.com/aylisrg/Platform-Delovoy/commit/9d7fdd12f2db6488069ea21a147e5f1c60defb68))
* **deploy:** Docker build + sidebar permissions + admin redirect ([#56](https://github.com/aylisrg/Platform-Delovoy/issues/56)) ([a366a8c](https://github.com/aylisrg/Platform-Delovoy/commit/a366a8cef9f6d29fd040fa04fc0565724c35265d))
* disable auto-merge, switch to PR-based flow, remove hardcoded pa… ([d9e2241](https://github.com/aylisrg/Platform-Delovoy/commit/d9e2241611c00e08b7833fc3cbb28b6aaa63029a))
* disable auto-merge, switch to PR-based flow, remove hardcoded password ([dad6007](https://github.com/aylisrg/Platform-Delovoy/commit/dad6007304406b78e649fbf8db6aedf24ede0411))
* fallback VPS_HOST to hardcoded IP when secret is missing ([6e6afc5](https://github.com/aylisrg/Platform-Delovoy/commit/6e6afc50a0f8d52e56c0d2485d7b3f8b764a2ae1))
* fallback VPS_HOST to hardcoded IP when secret is missing ([73c0aca](https://github.com/aylisrg/Platform-Delovoy/commit/73c0aca18c8c9e30449dce01a5597e00727c074f))
* global code review — critical deployment and security fixes ([4abb270](https://github.com/aylisrg/Platform-Delovoy/commit/4abb270bba26b2d632e79594b18489eb26d10009))
* **inventory:** fix 4 QA-found bugs in inventory + booking integration ([21f6040](https://github.com/aylisrg/Platform-Delovoy/commit/21f604045b697c746ef380f96128fd05530ce607))
* lint errors and update roadmap with completed phases ([aebfc79](https://github.com/aylisrg/Platform-Delovoy/commit/aebfc7965f2bb7ae80cfe194eabf26dc5d650b2a))
* migrate middleware.ts to proxy.ts for Next.js 16 ([456025e](https://github.com/aylisrg/Platform-Delovoy/commit/456025e417f24b76c072383a8288d6bdec535a1a))
* overhaul VPS deployment — GHCR build, zero-downtime, fix cache error ([60fe6f4](https://github.com/aylisrg/Platform-Delovoy/commit/60fe6f48bd89d467ea489f9bd40698fc25c27414))
* overhaul VPS deployment pipeline for zero-downtime releases ([563dd98](https://github.com/aylisrg/Platform-Delovoy/commit/563dd98da7b3bdb1c023365bd0c56d44d89d6f00))
* prevent Redis reconnection loop from consuming 100% CPU ([79f1c36](https://github.com/aylisrg/Platform-Delovoy/commit/79f1c36c88e38a03c1f810473645af2fbd5903d8))
* rebuild Timeweb infrastructure — healthcheck, memory limits, entrypoint ([ce33897](https://github.com/aylisrg/Platform-Delovoy/commit/ce33897d30f2eaa11cf6a2fc34a467ac0046b1a1))
* regenerate lockfile with optional deps for Linux CI ([8de5af6](https://github.com/aylisrg/Platform-Delovoy/commit/8de5af61e0cf015755d0ad6991fa11a82719e2a2))
* regenerate package-lock.json for CI compatibility ([f9c982c](https://github.com/aylisrg/Platform-Delovoy/commit/f9c982cf22c705fc093dd4dec5d027bce3ad5c2b))
* **release:** mobile-first, производительность, баги — подготовка к релизу ([#55](https://github.com/aylisrg/Platform-Delovoy/issues/55)) ([1219d63](https://github.com/aylisrg/Platform-Delovoy/commit/1219d635bcd92fb9bcc392cc9b0c287e6c27f21f))
* remove explicit `any` casts in rental service tests to pass ESLint ([3decabc](https://github.com/aylisrg/Platform-Delovoy/commit/3decabc51ec5afad4849242ba1c91468606e18dc))
* replace &lt;a&gt; with &lt;Link&gt; in signin page — fix CI lint error ([d85d6ad](https://github.com/aylisrg/Platform-Delovoy/commit/d85d6ade0ac9a591304473548a06db35cd479322))
* resolve ESLint errors in existing test files ([6b51758](https://github.com/aylisrg/Platform-Delovoy/commit/6b51758831bbe935e6048a1da92bc933500fa675))
* split auth config for Vercel edge middleware size limit ([51ef872](https://github.com/aylisrg/Platform-Delovoy/commit/51ef872ddd31ded679eb7acb2a01a855bd8433f2))
* sshpass deploy + crash loop protection + correct server ID ([88e2990](https://github.com/aylisrg/Platform-Delovoy/commit/88e2990994ee815d30afc115bd6c55418d984b1b))
* use .issues instead of .errors on ZodError in architect routes ([ba193e8](https://github.com/aylisrg/Platform-Delovoy/commit/ba193e847ed8ef14f152ab49c83622e1bc39c006))
* use correct HTTP status codes and NextRequest types in API routes ([38eafce](https://github.com/aylisrg/Platform-Delovoy/commit/38eafceeeea8f7546586dca17919331be7ce666b))
* упрощение деплоя — сборка на VPS, без registry ([bbc2d14](https://github.com/aylisrg/Platform-Delovoy/commit/bbc2d14c8019c9a474583ea5b9fde5f861c1d739))


### Reverts

* remove auto-fix CI workflow ([c793b70](https://github.com/aylisrg/Platform-Delovoy/commit/c793b701a5a87cf1c604e707b51bc2818b712f14))
