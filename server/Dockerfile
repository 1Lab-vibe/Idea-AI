FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./tsconfig.json
COPY src ./src

RUN npm run build

ENV PORT=8787
EXPOSE 8787

CMD ["npm", "start"]

