FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_RPC_URL=https://base-sepolia-rpc.publicnode.com
ARG VITE_PROTOCOL_EXPLORER_URL
ENV VITE_RPC_URL=$VITE_RPC_URL VITE_PROTOCOL_EXPLORER_URL=$VITE_PROTOCOL_EXPLORER_URL
RUN test -n "$VITE_PROTOCOL_EXPLORER_URL" && npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
