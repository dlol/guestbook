FROM node:22-bookworm-slim

EXPOSE 5678

RUN apt-get update -y && \
    apt-get upgrade -y && \
    apt-get autoclean -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /guestbook
COPY . .
RUN mkdir static-tmp
RUN mv /guestbook/src/static/* /guestbook/static-tmp

RUN npm install

RUN chmod +x /guestbook/entrypoint.sh

ENTRYPOINT ["/bin/sh", "-c", "/guestbook/entrypoint.sh"]
