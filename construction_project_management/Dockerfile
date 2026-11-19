# ---- Stage 1: build the React app (Create React App) ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# npm install (not npm ci): the team's package-lock.json is slightly out of sync
# with package.json, which makes npm ci refuse to run. npm install still uses the lockfile.
RUN npm install --no-audit --no-fund
COPY . .
# Don't fail the build on ESLint warnings
ENV CI=false
RUN npm run build

# ---- Stage 2: serve the built files with nginx ----
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
