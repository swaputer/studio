FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
COPY package.json package-lock.json ./
ARG STUDIO_NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci \
    --registry="$STUDIO_NPM_REGISTRY" \
    --replace-registry-host=always \
    --fetch-retries=5 \
    --maxsockets=1
COPY . .
ARG VITE_RPC_URL=https://ethereum-rpc.publicnode.com
ARG VITE_PROTOCOL_EXPLORER_URL
ENV VITE_RPC_URL=$VITE_RPC_URL VITE_PROTOCOL_EXPLORER_URL=$VITE_PROTOCOL_EXPLORER_URL
RUN test -n "$VITE_PROTOCOL_EXPLORER_URL" && npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
