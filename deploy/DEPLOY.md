# Развёртывание podvorye.com на VPS reg.ru

Сайт статический: html, css, один js и файлы. Ни базы, ни PHP, ни node не нужно.
На том же сервере уже живёт `kantstudio.ru` — он не затрагивается, добавляется
второй сайт рядом.

---

## Сначала: не сломать почту

На домене `podvorye.com` работает почта `holmogorskoye@podvorye.com`. Значит в DNS
уже есть записи `MX` и, скорее всего, `TXT` (SPF, DKIM).

**Трогаем только записи `A`. Записи `MX`, `TXT` и `CNAME` для почты не меняем
и не удаляем** — иначе почта перестанет ходить, а это заметят не сразу.

---

## 1. DNS

В панели, где обслуживается `podvorye.com`, нужны две записи:

| Тип | Имя | Значение |
|---|---|---|
| A | `@` | IP-адрес VPS |
| A | `www` | IP-адрес VPS |

IP смотрится в панели reg.ru у сервера или на самом сервере: `hostname -I`.

Обновление расходится от нескольких минут до нескольких часов. Проверка:

```
nslookup podvorye.com
```

Пока адрес не тот — дальше идти нет смысла, сертификат не выпустится.

---

## 2. Что за сервер

Дальнейшие шаги зависят от того, как обслуживается `kantstudio.ru`.

```
nginx -v                      # есть ли nginx
systemctl status nginx        # запущен ли
ls /etc/nginx/sites-enabled/  # какие сайты уже настроены
which ispmanager              # не стоит ли панель
```

**Если стоит панель (ISPmanager, FastPanel, Vesta)** — сайт добавляется через неё:
«Создать сайт» → домен `podvorye.com` → корневая папка. Файлы кладутся в указанную
папку, а конфиг из `podvorye.com.nginx.conf` берётся как образец: из него нужны
блоки про кеш и про видео.

**Если панели нет и есть чистый nginx** — по шагам ниже.

---

## 3. Файлы — через GitHub, как у kantstudio.ru

Сайт лежит в репозитории `Vitalik4444/holmogorskoe-podvorye`. Он **публичный**,
поэтому deploy-ключ не нужен: сервер клонирует его напрямую. Это единственное
отличие от схемы kantstudio, где репозиторий приватный.

```
ssh root@161.104.16.231

git clone https://github.com/Vitalik4444/holmogorskoe-podvorye.git /var/www/podvorye.com

# Папка отдаётся www-data, а git работает от root и на чужой репозиторий ругается
# «dubious ownership». Без этой строки git pull молча не сработает.
git config --global --add safe.directory /var/www/podvorye.com

chown -R www-data:www-data /var/www/podvorye.com
find /var/www/podvorye.com -type d -exec chmod 755 {} \;
find /var/www/podvorye.com -type f -exec chmod 644 {} \;
```

В корне должен оказаться `index.html`:

```
ls /var/www/podvorye.com
```

Сборка на сервере не нужна: в репозитории лежит уже готовая статика.

---

## 4. Конфигурация nginx

Конфигов два, и порядок важен. Боевой `podvorye.com.nginx.conf` ссылается на файлы
сертификата, которых на чистом сервере ещё нет: `nginx -t` на нём упадёт. Поэтому
сначала ставится временный, по нему certbot подтверждает домен, и только потом —
боевой.

```
cp /var/www/podvorye.com/deploy/podvorye.com.bootstrap.nginx.conf    /etc/nginx/sites-available/podvorye.com
ln -sfn /etc/nginx/sites-available/podvorye.com /etc/nginx/sites-enabled/podvorye.com
nginx -t && systemctl reload nginx
```

Если `nginx -t` ругается — не перезагружать, сначала разобраться: перезагрузка
со сломанным конфигом уронит и `kantstudio.ru`.

---

## 5. HTTPS

```
apt install certbot python3-certbot-nginx      # если ещё не стоит
certbot --nginx -d podvorye.com -d www.podvorye.com
```

Сертификат выпущен. Теперь на место временного конфига кладётся боевой — в нём
https, переадресация `www` → без www (канон один, дублей в поиске нет) и правила
кеша с видео. Certbot к этому моменту уже успел дописать своё во временный конфиг;
его правки боевой заменяет целиком, пути к сертификату в нём те же самые.

```
cp /etc/nginx/sites-available/podvorye.com /root/podvorye.com.nginx.bak
cp /var/www/podvorye.com/deploy/podvorye.com.nginx.conf    /etc/nginx/sites-available/podvorye.com
nginx -t && systemctl reload nginx
```

Если `nginx -t` ругнётся — вернуть бэкап и разбираться:
`cp /root/podvorye.com.nginx.bak /etc/nginx/sites-available/podvorye.com`

Продление происходит автоматически, проверить можно так:

```
certbot renew --dry-run
```

Продлению боевой конфиг не мешает: проверка ходит по http в
`/.well-known/acme-challenge/`, и этот путь в нём оставлен открытым.

---

## 6. Проверка после запуска

```
curl -I https://podvorye.com
```
Ожидается `HTTP/2 200`.

```
curl -I -H "Range: bytes=0-1023" https://podvorye.com/assets/video/hero-rows.mp4
```
**Обязательно должно быть `Accept-Ranges: bytes` и код `206`.** Без этого видео
в первом экране замрёт на первом кадре: перемотка по прокрутке физически
невозможна без частичных запросов.

Дальше в браузере:

- первый экран — кадр едет за прокруткой, текст сменяется;
- `https://podvorye.com/privacy.html` и `/terms.html` открываются;
- на телефоне история листается, видео идёт;
- ссылка, отправленная в мессенджер, разворачивается картинкой.

---

## 7. Обновление сайта потом

На рабочей машине правки собираются и уходят в репозиторий:

```
python build.py
cp -r dist/* publish/
cd publish && git add -A && git commit -m "что изменилось" && git push
```

На сервере — одна команда:

```
bash /var/www/podvorye.com/deploy/update.sh
```

Скрипт заберёт изменения, выставит права, проверит конфиг nginx, перезагрузит
его и убедится, что главная отвечает 200, а видео — 206 на частичный запрос.
Если что-то не так, он остановится с сообщением, а не оставит сайт сломанным.

Стили и скрипт подписаны хешем содержимого, поэтому правки доезжают
до посетителей сразу, без сброса кеша.

---

## Что нужно поменять руками 31 августа

В `index.html` такт открытия говорит «28 — 30 августа». После открытия его
нужно заменить на обычный режим работы. Проще всего — поправить в исходнике
и пересобрать.
