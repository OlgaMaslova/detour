FROM alpine:3.20
ARG PB_VERSION=0.39.4
RUN apk add --no-cache ca-certificates curl unzip
WORKDIR /pb
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb && chmod +x /pb/pocketbase && rm /tmp/pb.zip
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY pb_public /pb/pb_public
EXPOSE 8090
# Superusers are managed in the admin UI, not bootstrapped from env vars. The
# previous CMD ran `superuser create` on every boot, which silently recreated a
# deleted account on the next deploy. On an empty database PocketBase prints a
# one-time install URL to the logs (`flyctl logs`); to recover otherwise:
#   flyctl ssh console -a takedetour-api \
#     -C "/pb/pocketbase superuser upsert EMAIL PASSWORD --dir=/pb/pb_data"
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--encryptionEnv=PB_ENCRYPTION_KEY"]
