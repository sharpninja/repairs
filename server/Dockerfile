# ---- build: install deps + generate protobuf-es code from the .proto ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY buf.yaml buf.gen.yaml ./
COPY proto ./proto
RUN npx buf generate
COPY src ./src
# drop dev deps (buf) now that codegen is done
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/gen ./gen
COPY --from=build /app/src ./src
COPY package.json ./
EXPOSE 8080
CMD ["node", "src/server.js"]
