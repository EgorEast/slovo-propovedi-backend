FROM node:18.17-alpine

WORKDIR /app

COPY package.json .

RUN npm install

COPY . .

RUN npm build

EXPOSE 3000
CMD [ "node", "main.js" ]