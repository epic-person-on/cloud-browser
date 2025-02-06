# Use official Node.js 20 image
FROM node:20.18.2-bookworm-slim

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
