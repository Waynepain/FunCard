# Stufe 1: PNG-Icons aus den SVGs erzeugen (für Android-Installation und iOS-Homescreen)
FROM alpine:3.20 AS icons
RUN apk add --no-cache rsvg-convert
COPY icons /icons
RUN rsvg-convert -w 192 -h 192 /icons/icon.svg -o /icons/icon-192.png \
 && rsvg-convert -w 512 -h 512 /icons/icon.svg -o /icons/icon-512.png \
 && rsvg-convert -w 512 -h 512 /icons/icon-maskable.svg -o /icons/icon-maskable-512.png

# Stufe 2: statische Auslieferung mit nginx
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html manifest.webmanifest sw.js /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY decks /usr/share/nginx/html/decks
COPY --from=icons /icons /usr/share/nginx/html/icons
EXPOSE 80
HEALTHCHECK CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
