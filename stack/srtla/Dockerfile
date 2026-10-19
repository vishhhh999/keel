# SRTLA receiver (bonding): lets a phone or Belabox send over several connections at once
# (WiFi + one or more SIMs) and unbonds them into a single SRT stream for mediamtx.
# Upstream: https://github.com/BELABOX/srtla
#
# NOTE: this image is written from the upstream README and was NOT built or run during
# Keel's own testing (the build sandbox could not reach GitHub). See docs/TESTING.md.
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/BELABOX/srtla.git . && make

FROM debian:bookworm-slim
COPY --from=build /src/srtla_rec /usr/local/bin/srtla_rec
USER nobody
EXPOSE 5000/udp
# Receive SRTLA on :5000 and forward plain SRT to the ingest server.
ENTRYPOINT ["srtla_rec"]
CMD ["--srtla_port", "5000", "--srt_hostname", "mediamtx", "--srt_port", "8890"]
