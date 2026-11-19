# Backend: проект

Статус: черновик, решения приняты 2026-11-19.

## Решения
- **Стек:** Node.js (TypeScript) + Fastify, PostgreSQL, Docker Compose, nginx как обратный прокси.
- **Вход:** email + одноразовая ссылка (magic link). Паролей нет. Нужен SMTP для отправки писем.
- **Хостинг:** сервер OVH в ЕС, домен taalbrug.snapko.nl. Фронтенд остаётся одним `index.html`
  и ходит в `/api/*` на том же домене (без CORS).
- **Данные:** персональные данные учеников, в том числе беженцев. Требования AVG/GDPR:
  хранение в ЕС, шифрованный диск, регулярные бэкапы, минимум данных, удаление по запросу.

## Роли и права
| Роль | Видит и делает |
|---|---|
| learner | свой прогресс, опубликованные уроки, сдаёт письменные работы |
| teacher | свои группы, посещаемость, конструктор уроков, оценка работ |
| admin | всё: группы, список ожидания, рахунки, пользователи |
| client | только агрегаты по своим группам (без имён учеников) |

Роль проверяется на сервере в каждом запросе. Фронтенд ничего не решает сам.

## Модель данных (черновик)
- `users` (id, email, name, role, lang, created_at)
- `login_tokens` (token_hash, user_id, expires_at, used_at): одноразовые, живут 15 минут
- `sessions` (id, user_id, expires_at): httpOnly cookie
- `clients` (id, name, type: gemeente|employer)
- `groups` (id, name, type, client_id, teacher_id, capacity, lesson_no)
- `memberships` (group_id, user_id, intake_level, current_level, attendance, online_hours)
- `waitlist` (id, name, email, level, time_pref, pay_pref, created_at)
- `modules` / `lessons` / `exercises` (двуязычные поля nl/uk, `published`, порядок)
- `progress` (user_id, lesson_id, done, score), `known_words` (user_id, word), `flashcards` (user_id, card, box)
- `submissions` (id, user_id, lesson_id, text, grade, feedback, graded_by)
- `invoices` (id, client_id, description_nl/uk, amount, paid)

## API (первая версия)
- `POST /api/auth/request` (email), `GET /api/auth/verify?token=`, `POST /api/auth/logout`, `GET /api/me`
- `GET/PUT /api/me/progress`
- `GET /api/lessons`, `POST/PUT/DELETE /api/lessons/:id` (teacher/admin)
- `GET /api/groups`, `PATCH /api/groups/:id/attendance`
- `GET/POST /api/submissions`, `PATCH /api/submissions/:id` (оценка)
- `GET/POST /api/waitlist`, `POST /api/waitlist/:id/place`
- `GET /api/invoices`, `PATCH /api/invoices/:id`
- `GET /api/reports/:clientId` (агрегаты)

## Этапы
1. Каркас: Fastify + Postgres + миграции, вход по ссылке, `/api/me`, docker-compose, выкладка.
2. Прогресс учеников (`progress`, `known_words`, `flashcards`) вместо `localStorage`.
3. Конструктор уроков и письменные работы (teacher).
4. Группы, посещаемость, список ожидания, рахунки, отчёты для заказчиков.
5. Бэкапы, мониторинг, политика приватности, удаление данных.

## Открытые вопросы
- SMTP: какой почтовый сервис (OVH Email, Mailgun EU, другой)?
- Нужен ли заказчикам (gemeente/employer) свой вход или отчёты шлёт администратор?
- Сколько пользователей ожидается на старте (влияет на размер сервера)?
