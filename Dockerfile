FROM node:18

WORKDIR /app

COPY package.json .

RUN apt update \
    && npm install @nestjs/cli -g

RUN npm install

COPY . .

EXPOSE 3000

CMD [ "npm", "run", "start:dev" ]