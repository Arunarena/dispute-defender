# Hosted demo on Hugging Face Spaces (free, no card).
# Create a Docker Space and add this file as its "Dockerfile". It builds the app
# straight from GitHub, so each rebuild picks up the latest push to main.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Re-download the code whenever main has a new commit (this URL's content changes with each push).
ADD https://api.github.com/repos/Arunarena/dispute-defender/git/refs/heads/main /tmp/main.json
RUN git clone --depth 1 https://github.com/Arunarena/dispute-defender.git . && npm ci --omit=dev

# Spaces run the app as user 1000 ("node" in this image). It must be able to write data/.
RUN mkdir -p data && chown -R node:node /app
USER node

# Spaces send traffic to port 7860. No PayPal or Claude keys: judges get demo mode.
ENV PORT=7860 NODE_ENV=production
EXPOSE 7860
CMD ["node", "src/server.js"]
