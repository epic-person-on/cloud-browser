# Use official Node.js 20 image with Alpine Linux
FROM node:20.18.3-alpine3.21

LABEL org.opencontainers.image.description "An API cloudbrowser"

# Install Docker
RUN apk add --no-cache docker

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json)
# for installing dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose all ports (0.0.0.0)
EXPOSE 0-65535

# Set the default command to run your app
CMD ["node", "app.mjs"]
