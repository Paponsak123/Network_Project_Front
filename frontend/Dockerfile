FROM node:20-alpine

WORKDIR /app

# คัดลอก package.json เพื่อติดตั้ง Dependencies
COPY package.json package-lock.json* ./
RUN npm install

# คัดลอกโค้ดทั้งหมดและ Build Next.js
COPY . .
RUN npm run build

EXPOSE 3000

# สั่งรัน Next.js ในโหมด Production
CMD ["npm", "run", "start"]
