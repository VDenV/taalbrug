# Taalbrug Portaal

Портал курсов нидерландского. Сейчас это один статический `index.html` (данные в `localStorage`).

## Адреса
- GitHub Pages: https://vdenv.github.io/taalbrug/
- Сервер OVH: https://taalbrug.snapko.nl (после настройки)

## Выкладка на сервер OVH
1. DNS (Cloudflare): запись `A taalbrug` → IP сервера, режим **DNS only**.
2. Один раз на сервере: скопировать папку `deploy/` и выполнить
   `sudo EMAIL=you@example.com bash deploy/setup-server.sh` (nginx + HTTPS Let's Encrypt).
3. Каждый раз для обновления: `./deploy/deploy.sh user@IP`.
