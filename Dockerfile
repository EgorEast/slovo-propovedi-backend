FROM node:18.17 as builder

WORKDIR /app

RUN npm install @nestjs/cli -g

COPY package.json .

RUN npm install

COPY . .

RUN npm run build

FROM node:18.17-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./
COPY --from=builder /app/node_modules ./node_modules

RUN npm install --production

EXPOSE 3000
CMD [ "node", "main.js" ]