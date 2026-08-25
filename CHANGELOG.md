# Changelog

## [2.19.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.18.2...v2.19.0) (2026-08-25)


### Features

* **booking:** передача кассы в бухгалтерию и внятный признак оплаты ([#754](https://github.com/aylisrg/Platform-Delovoy/issues/754)) ([f645cba](https://github.com/aylisrg/Platform-Delovoy/commit/f645cbab4103c454e22eed7cb422280711556d5d))


### Bug Fixes

* **ci:** конвертер dependabot-singles падает на npm ci содержимого PR — мажоры остаются без задач ([#767](https://github.com/aylisrg/Platform-Delovoy/issues/767)) ([7bab0f2](https://github.com/aylisrg/Platform-Delovoy/commit/7bab0f29ca79197e5236482cc666dab9090c9f65))
* **ci:** конвертер dependabot-singles падает на npm ci содержимого PR — мажоры остаются без задач ([#769](https://github.com/aylisrg/Platform-Delovoy/issues/769)) ([152ae48](https://github.com/aylisrg/Platform-Delovoy/commit/152ae486b45e189ccea25845ca03fa62723cc3ab))

## [2.18.2](https://github.com/aylisrg/Platform-Delovoy/compare/v2.18.1...v2.18.2) (2026-08-24)


### Bug Fixes

* **watchdog:** root-cause issue не должна ловить комментарии живых инцидентов ([#755](https://github.com/aylisrg/Platform-Delovoy/issues/755)) ([4bbafeb](https://github.com/aylisrg/Platform-Delovoy/commit/4bbafebf7d7f28112f00a49d73d01ce145f9df00))

## [2.18.1](https://github.com/aylisrg/Platform-Delovoy/compare/v2.18.0...v2.18.1) (2026-08-23)


### Bug Fixes

* **incident-escalation:** root-cause issue closure не считается новым циклом инцидента ([#742](https://github.com/aylisrg/Platform-Delovoy/issues/742)) ([89c716f](https://github.com/aylisrg/Platform-Delovoy/commit/89c716f0c24a61b13ac84770761e41b866a20d9a)), closes [#698](https://github.com/aylisrg/Platform-Delovoy/issues/698)

## [2.18.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.17.0...v2.18.0) (2026-08-23)


### Features

* **gazebos:** публикация оферты и фиксация акцепта при онлайн-бронировании ([#731](https://github.com/aylisrg/Platform-Delovoy/issues/731)) ([9e1540d](https://github.com/aylisrg/Platform-Delovoy/commit/9e1540dbdec0cb26b49b19b580c841718f9df906))


### Bug Fixes

* **ci:** лейбл dependencies заводится автоматикой, конвертер спрашивает dependabot ([#729](https://github.com/aylisrg/Platform-Delovoy/issues/729)) ([01d3d13](https://github.com/aylisrg/Platform-Delovoy/commit/01d3d133f982490150848c4ffbc13721d8301d2c))

## [2.17.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.16.0...v2.17.0) (2026-08-21)


### Features

* **payments:** НДС 5% (vat_code 7) во всех чеках ЮKassa ([#709](https://github.com/aylisrg/Platform-Delovoy/issues/709)) ([9dd517c](https://github.com/aylisrg/Platform-Delovoy/commit/9dd517c9de4433f596c3453cbcfb399bebbd4457))
* **queue:** владелец вне GitHub — зонтики мелочи, деплой-трейн, решения в Telegram ([#710](https://github.com/aylisrg/Platform-Delovoy/issues/710)) ([b003768](https://github.com/aylisrg/Platform-Delovoy/commit/b0037683e65faa97b8648c37a4a2452cf633b60a))


### Bug Fixes

* **queue:** reject blocked-question паркует задачу — переспрос-петля исключена ([#715](https://github.com/aylisrg/Platform-Delovoy/issues/715)) ([263954d](https://github.com/aylisrg/Platform-Delovoy/commit/263954db29d76c9fc4943eb3f90c6fd5579d4109))
* **queue:** красный dependabot-PR лечится сам, одиночные бампы уходят в очередь ([#724](https://github.com/aylisrg/Platform-Delovoy/issues/724)) ([69b4a0f](https://github.com/aylisrg/Platform-Delovoy/commit/69b4a0fdf58d80cc9bd7eb4bb74ca4e12e33e5f4))

## [2.16.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.15.0...v2.16.0) (2026-08-18)


### Features

* **gazebos,ps-park:** UI + API создания ресурса (US-3, эпик [#442](https://github.com/aylisrg/Platform-Delovoy/issues/442)) ([#676](https://github.com/aylisrg/Platform-Delovoy/issues/676)) ([30a2dad](https://github.com/aylisrg/Platform-Delovoy/commit/30a2dad59673b654685388d309c224bfd16f88b6))
* **gazebos,ps-park:** автокомплит гостя по телефону в quick-форме (US-2, эпик [#442](https://github.com/aylisrg/Platform-Delovoy/issues/442)) ([#673](https://github.com/aylisrg/Platform-Delovoy/issues/673)) ([e46c37c](https://github.com/aylisrg/Platform-Delovoy/commit/e46c37c5d0aa87daccad5e8fb3e84d5062412ed2))
* **gazebos,ps-park:** комментарий и email в quick-форме бронирования (US-1, эпик [#442](https://github.com/aylisrg/Platform-Delovoy/issues/442)) ([#672](https://github.com/aylisrg/Platform-Delovoy/issues/672)) ([2953525](https://github.com/aylisrg/Platform-Delovoy/commit/2953525c0622b1691d28df299c536e37b64696f9))
* **gazebos,ps-park:** печатный лист дня (US-4, эпик [#442](https://github.com/aylisrg/Platform-Delovoy/issues/442)) ([#677](https://github.com/aylisrg/Platform-Delovoy/issues/677)) ([981a59d](https://github.com/aylisrg/Platform-Delovoy/commit/981a59de485360d0dd8dd4e194d7222469fea3cd))


### Bug Fixes

* **booking,gazebos,ps-park:** batch of 4 P2 QA/code-review findings ([#691](https://github.com/aylisrg/Platform-Delovoy/issues/691)) ([6aa4684](https://github.com/aylisrg/Platform-Delovoy/commit/6aa4684c94f9a332f75e6b84838fff4e89f75de8))
* **ci:** retry Docker push/Trivy scan on transient GHCR errors ([#690](https://github.com/aylisrg/Platform-Delovoy/issues/690)) ([389af64](https://github.com/aylisrg/Platform-Delovoy/commit/389af646dab87fcceb20b3ce6b81a2b1917bf408))
* **eval:** AC-трассируемость сворачивает AC-N.M в AC-N + ложный матч regex.test() как маркер ([#658](https://github.com/aylisrg/Platform-Delovoy/issues/658)) ([d18f798](https://github.com/aylisrg/Platform-Delovoy/commit/d18f798cd4d24c2af4d9b096b8588a40ff2b4477))
* **monitoring:** messenger getHealthMetrics + admin-дашборды считают soft-deleted Order/ChatMessage ([#663](https://github.com/aylisrg/Platform-Delovoy/issues/663)) ([29b9dfa](https://github.com/aylisrg/Platform-Delovoy/commit/29b9dfa933a4f5440d282951765e6ebad988326f))
* **ps-park:** pay-online route не фильтрует deletedAt: null (тот же паттерн [#512](https://github.com/aylisrg/Platform-Delovoy/issues/512)/[#564](https://github.com/aylisrg/Platform-Delovoy/issues/564)) ([#652](https://github.com/aylisrg/Platform-Delovoy/issues/652)) ([7676ac2](https://github.com/aylisrg/Platform-Delovoy/commit/7676ac2b2400e919c7923653165a5a08e944179a))

## [2.15.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.14.0...v2.15.0) (2026-08-16)


### Features

* **monitoring:** реестр SystemEvent.source и миграция колл-сайтов на logger.ts ([#634](https://github.com/aylisrg/Platform-Delovoy/issues/634)) ([18b3f17](https://github.com/aylisrg/Platform-Delovoy/commit/18b3f17551857a9bb9e3c8bd44a79be8aee267f5))
* **queue:** гейт машинально проверяет вердикты ревью + hold при недоступном diff миграции ([#633](https://github.com/aylisrg/Platform-Delovoy/issues/633)) ([88843da](https://github.com/aylisrg/Platform-Delovoy/commit/88843da96fa6d803f1d71227ae59b4390218265a))
* **queue:** телеметрия прогонов /next-issue в pipeline-metrics ([#635](https://github.com/aylisrg/Platform-Delovoy/issues/635)) ([2f1023d](https://github.com/aylisrg/Platform-Delovoy/commit/2f1023dbfa23a31fad9f937566be129d1d5843e5))


### Bug Fixes

* **cafe:** health-check считает soft-deleted MenuItem/Order (тот же баг что [#489](https://github.com/aylisrg/Platform-Delovoy/issues/489)/[#557](https://github.com/aylisrg/Platform-Delovoy/issues/557)) ([#651](https://github.com/aylisrg/Platform-Delovoy/issues/651)) ([890f1cf](https://github.com/aylisrg/Platform-Delovoy/commit/890f1cf805fa4e8d75238bdd40b0b8c042ded883))

## [2.14.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.13.0...v2.14.0) (2026-08-16)


### Features

* **eval:** AC-трассируемость — каждый AC из PRD покрыт тестом ([#640](https://github.com/aylisrg/Platform-Delovoy/issues/640)) ([b9c8002](https://github.com/aylisrg/Platform-Delovoy/commit/b9c800274046b82e2973ca33f9da40b76fee12df))
* **monitoring:** перфоманс-телеметрия nginx — p95/5xx в backlog-intake + поминутный 5xx-алерт ([#600](https://github.com/aylisrg/Platform-Delovoy/issues/600)) ([c9198fd](https://github.com/aylisrg/Platform-Delovoy/commit/c9198fd05541d1540c516ecdac15770b89b8ba16))


### Bug Fixes

* **auth:** /admin/* страницы отдавали контент без авторизации ([#632](https://github.com/aylisrg/Platform-Delovoy/issues/632)) ([02e9912](https://github.com/aylisrg/Platform-Delovoy/commit/02e9912d02fde13777921789df5706c9d656cf7b))
* **ps-park:** getTimeline() передаёт сырой Decimal pricePerHour в клиентские компоненты ([#641](https://github.com/aylisrg/Platform-Delovoy/issues/641)) ([8887b32](https://github.com/aylisrg/Platform-Delovoy/commit/8887b32533dcd19b5278c399b8f358d99d85a4df))
* **ps-park:** health-check считает soft-deleted брони в todayBookings ([#621](https://github.com/aylisrg/Platform-Delovoy/issues/621)) ([9bd55b2](https://github.com/aylisrg/Platform-Delovoy/commit/9bd55b2c7a5980b140d26dbf62de0e2003c775fb))
* **security:** GET /api/ps-park/bookings/[id]/bill не проверял requireAdminSection ([#623](https://github.com/aylisrg/Platform-Delovoy/issues/623)) ([1b44015](https://github.com/aylisrg/Platform-Delovoy/commit/1b44015e732dbf7206081dbabe647123b5dda5ee))
* **security:** удалить мёртвые легаси-роуты /api/rental и /api/rental/[id] ([#596](https://github.com/aylisrg/Platform-Delovoy/issues/596)) ([29064db](https://github.com/aylisrg/Platform-Delovoy/commit/29064dbf5cc4c6443668322aa918e62ef0921c7b)), closes [#529](https://github.com/aylisrg/Platform-Delovoy/issues/529)

## [2.13.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.12.2...v2.13.0) (2026-08-14)


### Features

* **ci:** Playwright E2E job — критические флоу против живого стека ([#592](https://github.com/aylisrg/Platform-Delovoy/issues/592)) ([c5acfbb](https://github.com/aylisrg/Platform-Delovoy/commit/c5acfbb5080aa535dac00010e4fdc02e4d3bbac3))
* **monitoring:** событийный CRITICAL-алертинг — log.critical() → Telegram ([#588](https://github.com/aylisrg/Platform-Delovoy/issues/588)) ([35e2bf1](https://github.com/aylisrg/Platform-Delovoy/commit/35e2bf12a917ba8e2604eda1b33c1bc40ea5a08e))
* **queue:** watchdog автономии — liveness AUTOMATION_TOKEN + суточный дайджест needs-owner ([#593](https://github.com/aylisrg/Platform-Delovoy/issues/593)) ([0df7436](https://github.com/aylisrg/Platform-Delovoy/commit/0df7436dc197c8da486a32646addac8420d54277))


### Bug Fixes

* **deploy:** smoke-тесты после деплоя не блокируют выкладку — сделать блокирующими с откатом ([#587](https://github.com/aylisrg/Platform-Delovoy/issues/587)) ([d2115fe](https://github.com/aylisrg/Platform-Delovoy/commit/d2115fef559becd29c0adc679a4cf3713b4af099))

## [2.12.2](https://github.com/aylisrg/Platform-Delovoy/compare/v2.12.1...v2.12.2) (2026-08-14)


### Bug Fixes

* **booking:** listBookingsPaginated молча игнорирует userId из фильтра ([#563](https://github.com/aylisrg/Platform-Delovoy/issues/563)) ([16821a5](https://github.com/aylisrg/Platform-Delovoy/commit/16821a58cea3e6f16751d314fb6f478904e35d2f))
* **feedback:** Не скролится на мобиле права ([#556](https://github.com/aylisrg/Platform-Delovoy/issues/556)) ([1518f6b](https://github.com/aylisrg/Platform-Delovoy/commit/1518f6b58e56abd25485fffc6f6a677236fe5bc6))
* **gazebos+ps-park:** quick-booking-popover minimum duration comes from settings, not a hardcoded constant ([#568](https://github.com/aylisrg/Platform-Delovoy/issues/568)) ([cb7665c](https://github.com/aylisrg/Platform-Delovoy/commit/cb7665c8bb321929ec1fec64c66dafd1915705a0)), closes [#523](https://github.com/aylisrg/Platform-Delovoy/issues/523)
* **gazebos:** health-check считает soft-deleted брони в todayBookings ([#558](https://github.com/aylisrg/Platform-Delovoy/issues/558)) ([927c384](https://github.com/aylisrg/Platform-Delovoy/commit/927c3842a3bb7733c99508e30fee8e784aec6ca8))
* **ps-park:** checkInBooking не фильтрует soft-deleted брони (deletedAt) ([#565](https://github.com/aylisrg/Platform-Delovoy/issues/565)) ([ef5adb7](https://github.com/aylisrg/Platform-Delovoy/commit/ef5adb7e6fc5e5357ab656162fc0b9ad930c25ce))

## [2.12.1](https://github.com/aylisrg/Platform-Delovoy/compare/v2.12.0...v2.12.1) (2026-08-14)


### Bug Fixes

* **webapp:** Mini App не обрабатывает 402 PENALTY_CONFIRMATION_REQUIRED при отмене брони ([#544](https://github.com/aylisrg/Platform-Delovoy/issues/544)) ([9b5aa0b](https://github.com/aylisrg/Platform-Delovoy/commit/9b5aa0bfe74ea500e277b8d0c59e9516cccb4388))
* **webapp:** главная Mini App — верный адрес парка + Центр уведомлений разделом для сотрудника ([#547](https://github.com/aylisrg/Platform-Delovoy/issues/547)) ([3b091f9](https://github.com/aylisrg/Platform-Delovoy/commit/3b091f90c1dad0fe399b2b3174cb9ebaeb880f3b))

## [2.12.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.11.0...v2.12.0) (2026-08-13)


### Features

* **booking:** выпадающий список статусов, отметка оплаты и заметная история ([#518](https://github.com/aylisrg/Platform-Delovoy/issues/518)) ([b06b5e5](https://github.com/aylisrg/Platform-Delovoy/commit/b06b5e5a97c4d0db2a9ec185a06116bde10af288))
* **booking:** история событий брони, восстановление и бейдж оплаты ([#516](https://github.com/aylisrg/Platform-Delovoy/issues/516)) ([2de9b54](https://github.com/aylisrg/Platform-Delovoy/commit/2de9b540166791d6d97d4aa293ae5bb18a63bc9e))
* **queue:** вынести мерж и запуск сессий из-под владельца ([#493](https://github.com/aylisrg/Platform-Delovoy/issues/493)) ([68c5e99](https://github.com/aylisrg/Platform-Delovoy/commit/68c5e99a34ee5c34abde9525b6452d287c477fc4))
* **webapp:** ролевой ребилд Telegram Mini App + дедупликация системных уведомлений ([#517](https://github.com/aylisrg/Platform-Delovoy/issues/517)) ([ef23b24](https://github.com/aylisrg/Platform-Delovoy/commit/ef23b24f72c82a0014dacfa10b0e5913102fa8b0))


### Bug Fixes

* **booking:** пагинация истории броней реально листает страницы ([#510](https://github.com/aylisrg/Platform-Delovoy/issues/510)) ([6478212](https://github.com/aylisrg/Platform-Delovoy/commit/647821208328af1262ce5558fc80fee5635e0927))
* **booking:** подтверждение перед завершением и отменой брони ([#514](https://github.com/aylisrg/Platform-Delovoy/issues/514)) ([a61c30a](https://github.com/aylisrg/Platform-Delovoy/commit/a61c30a0faa2773ff14f9d9f266c5040a90073ca))

## [2.11.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.10.0...v2.11.0) (2026-08-13)


### Features

* **cafe:** меню и цены с настенного прайса, кофе первым разделом ([#492](https://github.com/aylisrg/Platform-Delovoy/issues/492)) ([db6497a](https://github.com/aylisrg/Platform-Delovoy/commit/db6497a296b60f88bc6ee8d45c6aa37d56cd1644))
* **cafe:** минимальный чекаут — одно поле вместо трёх ([#497](https://github.com/aylisrg/Platform-Delovoy/issues/497)) ([58e2dc8](https://github.com/aylisrg/Platform-Delovoy/commit/58e2dc829438e50ea3c3e0514537cd7992610c9d))


### Bug Fixes

* **booking:** Zod-валидация тела PATCH статуса брони — отрицательные суммы больше не проезжают ([#498](https://github.com/aylisrg/Platform-Delovoy/issues/498)) ([c916b14](https://github.com/aylisrg/Platform-Delovoy/commit/c916b14ee449878863bfee793b1c960950fb3837))
* **booking:** бот cancel-booking больше не врёт про успех при штрафе ([#505](https://github.com/aylisrg/Platform-Delovoy/issues/505)) ([6292d85](https://github.com/aylisrg/Platform-Delovoy/commit/6292d8570a6716e7af8b5594a7d5794db3ce1fea))
* **booking:** учитывать CHECKED_IN в конфликт-чеках и таймлайне ([#476](https://github.com/aylisrg/Platform-Delovoy/issues/476)) ([f2ce14a](https://github.com/aylisrg/Platform-Delovoy/commit/f2ce14a6c9f4569609af8a62e5ff85b8159d39c9))
* **ci:** apply-cafe-menu падал на blue-green — exec по контейнеру, не по сервису ([#496](https://github.com/aylisrg/Platform-Delovoy/issues/496)) ([1102186](https://github.com/aylisrg/Platform-Delovoy/commit/11021860e498c8fa3f622c266f648e374b7c80f2))
* **deploy:** skip release notification for already-announced version ([#483](https://github.com/aylisrg/Platform-Delovoy/issues/483)) ([9d9bb95](https://github.com/aylisrg/Platform-Delovoy/commit/9d9bb952bf97a07983ee2d8a9c83687b51606a11)), closes [#482](https://github.com/aylisrg/Platform-Delovoy/issues/482)
* **gazebos,ps-park:** карточка брони в таймлайне показывает ошибки и открывает счёт при завершении ([#501](https://github.com/aylisrg/Platform-Delovoy/issues/501)) ([eb57dcc](https://github.com/aylisrg/Platform-Delovoy/commit/eb57dcca6d10cb124d0370e85fb06c785b36839b))
* **gazebos:** admин-брони записываются на клиента, а не на админа ([#500](https://github.com/aylisrg/Platform-Delovoy/issues/500)) ([ecf253a](https://github.com/aylisrg/Platform-Delovoy/commit/ecf253a29729997f846b3300dd6b149bc8610b0d))
* **ops:** сайт недоступен по имени — вернуть доп. IPv4, пропавший из DHCP-аренды Timeweb ([#491](https://github.com/aylisrg/Platform-Delovoy/issues/491)) ([e52f14a](https://github.com/aylisrg/Platform-Delovoy/commit/e52f14ad152474db86a0ba7203bc947bbf08bdfa))
* **webapp:** отмена брони через Mini App идёт через booking core ([#503](https://github.com/aylisrg/Platform-Delovoy/issues/503)) ([4ddffaa](https://github.com/aylisrg/Platform-Delovoy/commit/4ddffaa790977db70074401f275bff26f1858481))

## [2.10.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.9.0...v2.10.0) (2026-08-11)


### Features

* **ops:** исполнитель автоочереди переезжает в GitHub Actions ([#468](https://github.com/aylisrg/Platform-Delovoy/issues/468)) ([6ceb3b1](https://github.com/aylisrg/Platform-Delovoy/commit/6ceb3b1bb0d4d90e1c17f95b8fd43374ea0d453b))
* **ops:** очередь разбирается в сессии Claude Code, гейт сужен до необратимого ([#470](https://github.com/aylisrg/Platform-Delovoy/issues/470)) ([3d0c523](https://github.com/aylisrg/Platform-Delovoy/commit/3d0c523af23afb3d952fd65acc2cbbb37498d1cb))
* **queue:** автопополнение бэклога, автотриаж и починка движка очереди ([#474](https://github.com/aylisrg/Platform-Delovoy/issues/474)) ([c85915c](https://github.com/aylisrg/Platform-Delovoy/commit/c85915c9524670629163352b92096c8ebf0aa00d))


### Bug Fixes

* **booking:** сериализовать слот advisory-блокировкой — конец двойным броням ([#475](https://github.com/aylisrg/Platform-Delovoy/issues/475)) ([ee9c19e](https://github.com/aylisrg/Platform-Delovoy/commit/ee9c19e5f347964809a1cc69522067100db2f717))
* **ps-park:** закрыть публичный session-ending-alert — auth, Zod, escape, rate limit ([#472](https://github.com/aylisrg/Platform-Delovoy/issues/472)) ([22ba187](https://github.com/aylisrg/Platform-Delovoy/commit/22ba18743a49a3717630dc014e43a76b996b363b))

## [2.9.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.8.1...v2.9.0) (2026-08-11)


### Features

* **ops:** автономная очередь разгрузки бэклога issues ([#463](https://github.com/aylisrg/Platform-Delovoy/issues/463)) ([c763d33](https://github.com/aylisrg/Platform-Delovoy/commit/c763d330003b641cf7ebcf456f8579af8d7654be)), closes [#445](https://github.com/aylisrg/Platform-Delovoy/issues/445)

## [2.8.1](https://github.com/aylisrg/Platform-Delovoy/compare/v2.8.0...v2.8.1) (2026-08-10)


### Bug Fixes

* **ops:** PQ-проба, вывод Hetzner, ML-KEM на TLS-edge (issues [#452](https://github.com/aylisrg/Platform-Delovoy/issues/452), [#453](https://github.com/aylisrg/Platform-Delovoy/issues/453)) ([#459](https://github.com/aylisrg/Platform-Delovoy/issues/459)) ([70ec039](https://github.com/aylisrg/Platform-Delovoy/commit/70ec03985c22cf04bc5e91a5e6f7c72151d4479c))

## [2.8.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.7.0...v2.8.0) (2026-08-10)


### Features

* **cafe:** публичный раздел с QR-чекаутом (ЮKassa СБП/карта), каталог меню и статистика в админке ([#370](https://github.com/aylisrg/Platform-Delovoy/issues/370)) ([fc34a0b](https://github.com/aylisrg/Platform-Delovoy/commit/fc34a0bccd9f30e9495de0b29b87fe2a02f255c2))
* **gazebos:** mobile schedule redesign, booking edit + audit, weekend price fix, продление-reminder, public booking toggle ([#377](https://github.com/aylisrg/Platform-Delovoy/issues/377)) ([1992e17](https://github.com/aylisrg/Platform-Delovoy/commit/1992e170ac753aad0acd49cf614be62686d18264))
* **infra:** RU-aware monitoring, Hetzner relay fixes, blue-green deploy, node22 ([#374](https://github.com/aylisrg/Platform-Delovoy/issues/374)) ([d02c060](https://github.com/aylisrg/Platform-Delovoy/commit/d02c06087089b1107a43275d9b84e92e6653d0b4))
* **notifications:** kill switch + редактируемая матрица каналов на /admin/monitoring ([#376](https://github.com/aylisrg/Platform-Delovoy/issues/376)) ([3830ebd](https://github.com/aylisrg/Platform-Delovoy/commit/3830ebd093a829eee488b131f56e0f887ceb294b))
* **notifications:** per-channel Telegram test buttons on monitoring page ([#366](https://github.com/aylisrg/Platform-Delovoy/issues/366)) ([2a9ae6d](https://github.com/aylisrg/Platform-Delovoy/commit/2a9ae6dfaa76a3fd99efa2e3ccb176718843a28e))


### Bug Fixes

* **booking:** parse & display booking times in Moscow TZ, not server TZ ([#369](https://github.com/aylisrg/Platform-Delovoy/issues/369)) ([5ec6ada](https://github.com/aylisrg/Platform-Delovoy/commit/5ec6ada4e31d4e2dced15a2851cff440f243b0b7))
* **gazebos:** date-navigator TZ, list→schedule deep-link, received-money analytics ([#375](https://github.com/aylisrg/Platform-Delovoy/issues/375)) ([88fa63e](https://github.com/aylisrg/Platform-Delovoy/commit/88fa63eef3badef7d985bf80ee66de30af4e8b1b))
* **infra:** надёжная доступность из РФ + починка Telegram-транспорта (глобальный инфра-рефакторинг) ([#372](https://github.com/aylisrg/Platform-Delovoy/issues/372)) ([2294380](https://github.com/aylisrg/Platform-Delovoy/commit/2294380cdcfb41731779537a448c044c3cfcdc16))
* **ops:** provision релея падал с exit 127 под root ("-E: command not found") ([#446](https://github.com/aylisrg/Platform-Delovoy/issues/446)) ([b10042b](https://github.com/aylisrg/Platform-Delovoy/commit/b10042b519fd3f82fd43e488dc9cbd1c58ff19bb))

## [2.7.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.6.0...v2.7.0) (2026-07-21)


### Features

* **admin,notifications:** статус оплаты броней + Telegram-канал «только оплаченные» ([#353](https://github.com/aylisrg/Platform-Delovoy/issues/353)) ([0f64401](https://github.com/aylisrg/Platform-Delovoy/commit/0f64401f9803a35587a8758c18085f8cd16b1440))
* **agent:** persistent tasks, session continuity, system prompt, git sync ([#328](https://github.com/aylisrg/Platform-Delovoy/issues/328)) ([a0409c8](https://github.com/aylisrg/Platform-Delovoy/commit/a0409c880f9a30fcc586d9e17605731afd9d5da3))
* **gazebos:** ADMIN delete rights + dedicated Telegram channel ([#345](https://github.com/aylisrg/Platform-Delovoy/issues/345)) ([679dd0f](https://github.com/aylisrg/Platform-Delovoy/commit/679dd0fedb2d91f11cf65068be04b2268ba7a0d1))
* **gazebos:** синхронизация прайса беседок с прайс-листом + автостоянка ([#363](https://github.com/aylisrg/Platform-Delovoy/issues/363)) ([900c51d](https://github.com/aylisrg/Platform-Delovoy/commit/900c51d326c83f249555cbc2627eaa20ba981992))
* **monitoring:** вотчдог видит то, что видят пользователи + клиентский error-beacon ([#361](https://github.com/aylisrg/Platform-Delovoy/issues/361)) ([8b4e44b](https://github.com/aylisrg/Platform-Delovoy/commit/8b4e44bd20a258625381b97050a2a32c3ee203df))
* **parking:** отдельная страница услуги «Автостоянка» + раздел в меню ([#365](https://github.com/aylisrg/Platform-Delovoy/issues/365)) ([6dc09e3](https://github.com/aylisrg/Platform-Delovoy/commit/6dc09e36f748a5dc65a4711e13381a5bea64f6c9))
* send booking reminders to guest bookings via module channel ([#347](https://github.com/aylisrg/Platform-Delovoy/issues/347)) ([f7a794c](https://github.com/aylisrg/Platform-Delovoy/commit/f7a794cfb6c0956a43897aea6b33c8eb3cc13c9c))
* онлайн-оплата ЮKassa — план + модуль payments (беседки, абонементы, PS Park) ([#349](https://github.com/aylisrg/Platform-Delovoy/issues/349)) ([f809de1](https://github.com/aylisrg/Platform-Delovoy/commit/f809de120707fdaa70fec3da2a0958ea82c39d69))


### Bug Fixes

* **agent:** workspace permissions, claude auth path, login action ([#329](https://github.com/aylisrg/Platform-Delovoy/issues/329)) ([880024b](https://github.com/aylisrg/Platform-Delovoy/commit/880024b2a4740a34d20efc2b0c8985bebc350925))
* always pass --dangerously-skip-permissions to claude runner ([4e73f3e](https://github.com/aylisrg/Platform-Delovoy/commit/4e73f3e71ee7fe63e906c6a2f6f7d62eac436baa))
* build agent image for linux/arm64 (Hetzner cax11) ([957f708](https://github.com/aylisrg/Platform-Delovoy/commit/957f70855fccf23f3ad977ff6137c69c47a5265f))
* delete existing SSH key before recreating on Hetzner ([#318](https://github.com/aylisrg/Platform-Delovoy/issues/318)) ([c9c5d25](https://github.com/aylisrg/Platform-Delovoy/commit/c9c5d25347326b01461107286ceb765adcafa3b6))
* **deploy:** старт контейнера за секунды вместо минут + статика переживает деплой ([#360](https://github.com/aylisrg/Platform-Delovoy/issues/360)) ([24ce211](https://github.com/aylisrg/Platform-Delovoy/commit/24ce211c9316c444e311f5a5208b05732c9d872b))
* find SSH key by content on Hetzner ([#320](https://github.com/aylisrg/Platform-Delovoy/issues/320)) ([ac91500](https://github.com/aylisrg/Platform-Delovoy/commit/ac91500f7753f438e3c411047af79e272a7cc31b))
* **gazebos:** report Telegram network failure clearly instead of 500 ([#348](https://github.com/aylisrg/Platform-Delovoy/issues/348)) ([ce5d800](https://github.com/aylisrg/Platform-Delovoy/commit/ce5d80061744211a686f3e83a6c78ec54c9931b5))
* **notifications:** Telegram недоступен с VPS — таймауты, TELEGRAM_API_ROOT/PROXY_URL, диагностический workflow ([#350](https://github.com/aylisrg/Platform-Delovoy/issues/350)) ([442dc87](https://github.com/aylisrg/Platform-Delovoy/commit/442dc87e6e3332694fad53456abc64f26e9dc6cb))
* **ops:** устранение периодической недоступности сайта — watchdog c авто-восстановлением, бэкапы, Stage 3 ([#355](https://github.com/aylisrg/Platform-Delovoy/issues/355)) ([4045ca3](https://github.com/aylisrg/Platform-Delovoy/commit/4045ca39fab2a94b2fffe9da31a94d4bbb8e7ece))
* **payments:** доставка вебхук-секрета и починка регистрации кронов ([#351](https://github.com/aylisrg/Platform-Delovoy/issues/351)) ([86cdc3d](https://github.com/aylisrg/Platform-Delovoy/commit/86cdc3d393033f46242257c4208dd85b15adbfb4))
* prevent infinite WebApp spinner when Telegram SDK loads late (Safari) ([#341](https://github.com/aylisrg/Platform-Delovoy/issues/341)) ([6dd74f2](https://github.com/aylisrg/Platform-Delovoy/commit/6dd74f2aa09c66f0c3ab193aca076d724ed788cc))
* replace framer-motion with pure CSS for FadeInSection ([#344](https://github.com/aylisrg/Platform-Delovoy/issues/344)) ([c746595](https://github.com/aylisrg/Platform-Delovoy/commit/c7465958a42db7b4b01b4905e30915cbb716534e))
* run agent as non-root user to allow --dangerously-skip-permissions ([41462e9](https://github.com/aylisrg/Platform-Delovoy/commit/41462e9a9e19b5cc2fb0de9a440b670747fa3ec1))
* **sw:** cache never breaks the page — versioned, bounded, fetch fallback ([#359](https://github.com/aylisrg/Platform-Delovoy/issues/359)) ([ba10884](https://github.com/aylisrg/Platform-Delovoy/commit/ba10884dcfc5fd7d6bc7223eb49dd6e1da166ab5))


### Performance Improvements

* **public:** вебвизор off, ISR-кэш маркетинговых страниц, ленивые видео, шрифты, rAF-гейт ([#362](https://github.com/aylisrg/Platform-Delovoy/issues/362)) ([75d93e6](https://github.com/aylisrg/Platform-Delovoy/commit/75d93e63d206ed659405b7748342ccda4d9f8966))

## [2.6.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.5.0...v2.6.0) (2026-05-26)


### Features

* **admin:** park switcher + global Users nav ([#284](https://github.com/aylisrg/Platform-Delovoy/issues/284)) ([3f5cfb2](https://github.com/aylisrg/Platform-Delovoy/commit/3f5cfb26a263c917db291e56673c21ad814e936a))
* **gazebos:** enforce 4-hour minimum booking duration ([#273](https://github.com/aylisrg/Platform-Delovoy/issues/273)) ([857f68d](https://github.com/aylisrg/Platform-Delovoy/commit/857f68d2c80584244aa1cf2ee91ab54b4e1bfc98))
* **messenger:** in-app chat — SUPPORT/DIRECT/GROUP + SSE realtime + Web Push + PWA ([#287](https://github.com/aylisrg/Platform-Delovoy/issues/287)) ([8d6a98b](https://github.com/aylisrg/Platform-Delovoy/commit/8d6a98b2eb20fdb6852d0b06975c08620024bdef))
* **nedelovoy:** второй бизнес-парк + заглушка бань ([#274](https://github.com/aylisrg/Platform-Delovoy/issues/274)) ([bf08761](https://github.com/aylisrg/Platform-Delovoy/commit/bf087614d10ccc254c881a1ddbc9bdf02ef8a0e3))
* **notifications:** cron overdue session reminders (PR 4/4) ([#256](https://github.com/aylisrg/Platform-Delovoy/issues/256)) ([ae59776](https://github.com/aylisrg/Platform-Delovoy/commit/ae5977604dfb500a96845c402a86de0252cdb6f9))
* **rental:** fix landing form + lead→task + per-module TG recipients ([#268](https://github.com/aylisrg/Platform-Delovoy/issues/268)) ([845c55b](https://github.com/aylisrg/Platform-Delovoy/commit/845c55b41f46db5b03b450c61fa970751015faee))
* **sprint-1:** broadcast campaigns + legalize modules + cleanup ([#295](https://github.com/aylisrg/Platform-Delovoy/issues/295)) ([0bad963](https://github.com/aylisrg/Platform-Delovoy/commit/0bad96307378eb378027f88de2a7db7429aae657))
* VK ID OAuth + VK notifications channel + rental TG group routing ([#269](https://github.com/aylisrg/Platform-Delovoy/issues/269)) ([4735c0e](https://github.com/aylisrg/Platform-Delovoy/commit/4735c0e5120b94a3a58645aa62fa523db2e7a6e4))


### Bug Fixes

* **agent:** inline workspace bootstrap script in setup workflow ([#292](https://github.com/aylisrg/Platform-Delovoy/issues/292)) ([994b87e](https://github.com/aylisrg/Platform-Delovoy/commit/994b87e88bb77be017dc855a08d25531c2dde250))
* **analytics:** prevent 429 quota_parallel_requests_by_uid from Yandex Metrika ([#285](https://github.com/aylisrg/Platform-Delovoy/issues/285)) ([f9d567a](https://github.com/aylisrg/Platform-Delovoy/commit/f9d567a77019932db5bb6974772724303589a7aa))
* **analytics:** replace 200%-conversion bug with primary-goal selector + Telegram warning ([#267](https://github.com/aylisrg/Platform-Delovoy/issues/267)) ([51bc8ac](https://github.com/aylisrg/Platform-Delovoy/commit/51bc8acfd7fd425b1683b9dc283043f6461bf679))
* **auth:** guard VkIdProvider behind env-var check ([#272](https://github.com/aylisrg/Platform-Delovoy/issues/272)) ([5146dee](https://github.com/aylisrg/Platform-Delovoy/commit/5146dee7c9c69c25c717dbc0808838661087ef5b))
* auto-select non-deprecated server type from Hetzner API ([#303](https://github.com/aylisrg/Platform-Delovoy/issues/303)) ([9a86975](https://github.com/aylisrg/Platform-Delovoy/commit/9a869753b84d9fb57ae252104ce884ecbff24047))
* catch-up migration + deploy pipeline fix ([#275](https://github.com/aylisrg/Platform-Delovoy/issues/275)) ([298e396](https://github.com/aylisrg/Platform-Delovoy/commit/298e39680547f77f9cad6eea5920bd72e2894337))
* delete duplicate SSH key before creating on Hetzner ([#300](https://github.com/aylisrg/Platform-Delovoy/issues/300)) ([a8ed9bf](https://github.com/aylisrg/Platform-Delovoy/commit/a8ed9bf5a5d3070b080b4025bd4c9f55b6b408d3))
* **deploy:** fix missing migration INSERT — use WHERE NOT EXISTS ([#283](https://github.com/aylisrg/Platform-Delovoy/issues/283)) ([41887e3](https://github.com/aylisrg/Platform-Delovoy/commit/41887e331debf7064ff80c0e05e9dc767215ff33))
* **deploy:** p3009 recovery workflow + clean deploy.yml migrate step ([#281](https://github.com/aylisrg/Platform-Delovoy/issues/281)) ([d73c2b6](https://github.com/aylisrg/Platform-Delovoy/commit/d73c2b6a1acdd6f55802252dba0b98e65d64d349))
* **deploy:** resolve stuck migration via SQL patch + comprehensive recovery ([#282](https://github.com/aylisrg/Platform-Delovoy/issues/282)) ([3397ff8](https://github.com/aylisrg/Platform-Delovoy/commit/3397ff88b30e61d0330486e00b44a8884e84820d))
* **deploy:** SSH timeout 30m + make agent restart non-fatal ([#293](https://github.com/aylisrg/Platform-Delovoy/issues/293)) ([385c0a1](https://github.com/aylisrg/Platform-Delovoy/commit/385c0a1d3385fbd1e82a654de8a140a2adc13586))
* hardcode cax11 server type (ARM 2vCPU 4GB, works in fsn1) ([#306](https://github.com/aylisrg/Platform-Delovoy/issues/306)) ([491f851](https://github.com/aylisrg/Platform-Delovoy/commit/491f851ec5380ab11fe8db469407d8d6c553bb98))
* improve server type selection + debug logging ([#305](https://github.com/aylisrg/Platform-Delovoy/issues/305)) ([db158cf](https://github.com/aylisrg/Platform-Delovoy/commit/db158cf2efc6c9d138602d8c04657f903d6dd78e))
* **messenger:** register admin nav section (follow-up to [#287](https://github.com/aylisrg/Platform-Delovoy/issues/287)) ([#288](https://github.com/aylisrg/Platform-Delovoy/issues/288)) ([d22775e](https://github.com/aylisrg/Platform-Delovoy/commit/d22775e7599dbb014b271adf9561f2d198975d3e))
* **messenger:** show error details + API error handling + park path fix ([#296](https://github.com/aylisrg/Platform-Delovoy/issues/296)) ([5b89a43](https://github.com/aylisrg/Platform-Delovoy/commit/5b89a438aaa07c2ed8f5f0791068be70ef794b10))
* **notifications:** restore legacy chatId fallback for admin notifications ([#271](https://github.com/aylisrg/Platform-Delovoy/issues/271)) ([a8771e5](https://github.com/aylisrg/Platform-Delovoy/commit/a8771e5a77188f0e1b926cf7c6ad6f00db4d2c71))
* **notifications:** wire processOutgoing cron + monitoring resilience ([#286](https://github.com/aylisrg/Platform-Delovoy/issues/286)) ([11cb8cd](https://github.com/aylisrg/Platform-Delovoy/commit/11cb8cdb4632535b9f2d4a4a6839d860a5fc19fb))
* reuse existing Hetzner server if already created ([#308](https://github.com/aylisrg/Platform-Delovoy/issues/308)) ([987a0b0](https://github.com/aylisrg/Platform-Delovoy/commit/987a0b0434632e7ccfc6b813fd8d40c6835afa65))
* show Hetzner API error details in workflow ([#298](https://github.com/aylisrg/Platform-Delovoy/issues/298)) ([9fd8350](https://github.com/aylisrg/Platform-Delovoy/commit/9fd8350a30f9031b1acc628f80c5c0891cf2af09))
* use cpx11 server type (cx22 deprecated on Hetzner) ([#301](https://github.com/aylisrg/Platform-Delovoy/issues/301)) ([05981f0](https://github.com/aylisrg/Platform-Delovoy/commit/05981f0500b358dece9a92f3adc1eeb1c69550dc))
* use cx32 server type (cpx11 unavailable in nbg1) ([#302](https://github.com/aylisrg/Platform-Delovoy/issues/302)) ([fd279dc](https://github.com/aylisrg/Platform-Delovoy/commit/fd279dc6c1345def450f9512046951deed503c43))
* use fsn1 location (cpx11 not available in nbg1) ([#304](https://github.com/aylisrg/Platform-Delovoy/issues/304)) ([8ab35fe](https://github.com/aylisrg/Platform-Delovoy/commit/8ab35fe38d76b4007c0d2f6e839a95c5f3b094d4))
* use gh secret set to save Hetzner secrets ([#307](https://github.com/aylisrg/Platform-Delovoy/issues/307)) ([4bb2864](https://github.com/aylisrg/Platform-Delovoy/commit/4bb2864bd3d23d856381914c68695ae8daf5e31a))
* use jq to build Hetzner API JSON payload ([#299](https://github.com/aylisrg/Platform-Delovoy/issues/299)) ([75daed8](https://github.com/aylisrg/Platform-Delovoy/commit/75daed8a09d41ebdd82be8f04a03fbcbdada9ea8))

## [2.5.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.4.0...v2.5.0) (2026-05-10)


### Features

* **notifications:** default release notifications to ON for managers/admins ([#249](https://github.com/aylisrg/Platform-Delovoy/issues/249)) ([c36297f](https://github.com/aylisrg/Platform-Delovoy/commit/c36297fbd0b7ae47064103922d9666b8188cb78e))
* **notifications:** web push channel skeleton (PR 1/4 overdue reminders) ([#250](https://github.com/aylisrg/Platform-Delovoy/issues/250)) ([2d7703c](https://github.com/aylisrg/Platform-Delovoy/commit/2d7703ce59a991933ee2222d1487cbb8af73d8e9))
* **notifications:** web push PWA + UI opt-in (PR 3/4 overdue reminders) ([#254](https://github.com/aylisrg/Platform-Delovoy/issues/254)) ([753b212](https://github.com/aylisrg/Platform-Delovoy/commit/753b21202852b1e781e52c5772ff5158247cd71c))
* **notifications:** web-push API routes (PR 2/4 overdue reminders) ([#252](https://github.com/aylisrg/Platform-Delovoy/issues/252)) ([97d6e6b](https://github.com/aylisrg/Platform-Delovoy/commit/97d6e6b15d7d93c523b0d53914752bb23233e005))


### Bug Fixes

* **deploy:** run @DelovoyPark_bot as separate docker service [CRITICAL] ([#255](https://github.com/aylisrg/Platform-Delovoy/issues/255)) ([2d8a39e](https://github.com/aylisrg/Platform-Delovoy/commit/2d8a39e3f4472d1ada207265ef757ccdd48aa7ac))
* **ps-park:** disable auto-complete endpoint by policy ([#248](https://github.com/aylisrg/Platform-Delovoy/issues/248)) ([8c16296](https://github.com/aylisrg/Platform-Delovoy/commit/8c16296f1b43641c3301fe30e5c73245969e781d))

## [2.4.0](https://github.com/aylisrg/Platform-Delovoy/compare/v2.3.0...v2.4.0) (2026-05-10)


### Features

* **auth:** bot-to-web one-time login token (backend) ([#228](https://github.com/aylisrg/Platform-Delovoy/issues/228)) ([5f6574d](https://github.com/aylisrg/Platform-Delovoy/commit/5f6574dca11cda09bd7e7170b901de4535f313ae))
* **bot:** bot-to-web one-time login url for returning users ([#229](https://github.com/aylisrg/Platform-Delovoy/issues/229)) ([9dd09a1](https://github.com/aylisrg/Platform-Delovoy/commit/9dd09a125d869eb13b92304ea1300728dcae87e9))
* **clients:** F8 — per-module guests views + RBAC isolation ([#244](https://github.com/aylisrg/Platform-Delovoy/issues/244)) ([6eb471b](https://github.com/aylisrg/Platform-Delovoy/commit/6eb471b884b5b415d7941566983683cfa94b0b36))


### Bug Fixes

* **admin:** expose /admin/clients in sidebar nav ([#238](https://github.com/aylisrg/Platform-Delovoy/issues/238)) ([e1d8672](https://github.com/aylisrg/Platform-Delovoy/commit/e1d8672dc4038ce03c692ba22eb49fd68d28a35b))
* **admin:** expose per-module guests + subscriptions tabs ([#245](https://github.com/aylisrg/Platform-Delovoy/issues/245)) ([e9e365f](https://github.com/aylisrg/Platform-Delovoy/commit/e9e365fd17c0fcb262ecef72296e6dd98f9e9e94))
* **analytics:** чиним 400-ошибки Метрики в /admin/analytics ([#246](https://github.com/aylisrg/Platform-Delovoy/issues/246)) ([9a28015](https://github.com/aylisrg/Platform-Delovoy/commit/9a28015650f19fff26009248f6db98b4f62235d4))
* **ci:** unblock production deploy via push-to-main fallback trigger ([#239](https://github.com/aylisrg/Platform-Delovoy/issues/239)) ([8e13eeb](https://github.com/aylisrg/Platform-Delovoy/commit/8e13eeb67a0eedfa80e892e4cde111ae9305bfc1))

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
