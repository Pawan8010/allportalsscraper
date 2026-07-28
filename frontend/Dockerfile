FROM node:20-bullseye AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-bullseye
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public 2>/dev/null || true
COPY package.json next.config.js ./
EXPOSE 3000
CMD ["npm", "run", "start"]
