# Headless OBS Studio with obs-websocket (built in since OBS 28).
# Software x264 by default so it runs anywhere. For NVENC see docs/GPU.md.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      obs-studio xvfb xauth x11-utils \
      libgl1-mesa-dri libgl1 libegl1 \
      fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# OBS runs as an unprivileged user.
RUN useradd -m obs
USER obs
ENV HOME=/home/obs \
    LIBGL_ALWAYS_SOFTWARE=1 \
    QT_QPA_PLATFORM=xcb

COPY --chown=obs:obs entrypoint.sh /home/obs/entrypoint.sh
RUN chmod +x /home/obs/entrypoint.sh

EXPOSE 4455
ENTRYPOINT ["/home/obs/entrypoint.sh"]
