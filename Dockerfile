FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea
ARG DRAWIO_VERSION=32.3.0
ARG DRAWIO_SHA256=ef60ee194d8b45990dfaef2541cce8792c81d4df4cd17c7ccdcc3c3f8b3a1754
ARG DEBIAN_SNAPSHOT=20261022T120000Z
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN sed -i -e "s#http://deb.debian.org/debian-security#http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}#" \
    -e "s#http://deb.debian.org/debian\$#http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}#" \
    -e "s#^Components: main#Components: main\nCheck-Valid-Until: no#" /etc/apt/sources.list.d/debian.sources \
 && grep -q snapshot.debian.org/archive/debian/ /etc/apt/sources.list.d/debian.sources \
 && node -e "fetch(process.argv[1]).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer() }).then(b => require('fs').writeFileSync('/tmp/drawio.deb', Buffer.from(b)))" \
    "https://github.com/jgraph/drawio-desktop/releases/download/v${DRAWIO_VERSION}/drawio-amd64-${DRAWIO_VERSION}.deb" \
 && echo "${DRAWIO_SHA256}  /tmp/drawio.deb" | sha256sum -c - \
 && apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends /tmp/drawio.deb libasound2t64 libgbm1 xvfb xauth fonts-inter fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* /tmp/drawio.deb \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
 && useradd --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin render
COPY --from=build /src/dist/main.mjs /app/main.mjs
LABEL org.opencontainers.image.source="https://github.com/ptMuta/git-confluence-sync"
ENTRYPOINT ["node", "/app/main.mjs"]
