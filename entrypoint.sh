#!/bin/sh

[ -z "$(ls -A "/guestbook/src/static")" ] && cp static-tmp/* /guestbook/src/static
[ ! -f "/guestbook/config/config.yml" ]   && cp /guestbook/config.yml /guestbook/config/config.yml

node src/index.js --docker
