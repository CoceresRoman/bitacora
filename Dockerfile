FROM node:22-slim

WORKDIR /app

# node:22-slim ships without OpenSSL headers, which makes Prisma unable to
# detect the libssl version and fall back to a guess. Installing it
# explicitly avoids a mismatched query engine binary at runtime.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first so this layer is cached while source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generates the Prisma client into node_modules/@prisma/client so the build
# and the runtime `dist/main.js` can both resolve it.
RUN npx prisma generate

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/main.js"]
